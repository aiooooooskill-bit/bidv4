"""审计边界探针：期望正确行为；失败即保留证据，不改生产实现。"""
import functools,json,subprocess,sys
from pathlib import Path
import pytest
from app import config,artifact_store
from app.services import build_state
from app.dispatch_enrich import build_enriched_description
from tests.test_dispatch_enrich import env as dispatch_env, _seed
from tests.test_section_write_atomicity import env as atomic_env,request
from tests.test_revision_revalidation import action

@pytest.mark.parametrize('kind,desc',[('revise','写 3.1 项目理解'),('revise','写 3.1 项目理解、3.2 总体设计'),('body','写 3.1 项目理解'),('build','写 3.1 项目理解、3.2 总体设计')])
def test_original_instruction_reaches_short_multi_and_generation_branches(dispatch_env,kind,desc):
 tid=_seed(dispatch_env);p=config.data_dir()/'actions'/tid/'latest.json';p.parent.mkdir(parents=True,exist_ok=True)
 instruction='工程核验唯一要求：保留数据表和现有图片，仅按本轮指定范围处理，业务问题只记录。'
 p.write_text(json.dumps({'kind':kind,'instruction':instruction}))
 out=build_enriched_description(desc,tid)
 assert instruction in out and out.count(instruction)==1, f'{kind}:动作已持久化原始要求，但写手消息缺失'

@pytest.mark.parametrize('initial',['ready','pending','stale'])
def test_successful_validation_cannot_accept_a_new_write_after_it_read_the_old_doc(atomic_env,initial):
 tid,root,_=atomic_env
 build_state.record_validation(tid,'body/实施方案.docx')
 if initial=='pending':
  code,_=request(atomic_env);assert code==0
 elif initial=='stale':
  g=root/'body/写作指引.md';g.write_text('发生了新的当前规划')
 action(atomic_env)
 payload={'operation':'tool','args':{'name':'validate_body','parameters':{'section':'./body/实施方案.docx'}},'data_root':str(config.data_dir()),'task_id':tid,'session_id':'parent','call_id':'old-validation'}
 # Interleave a real new transactional write after the old checker has returned
 # and before its caller publishes validation. No validator result is forged.
 code=r'''
import functools,runpy,sys,json
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1]).parent))
import app.tools as registry
from app.services.section_write import execute
from app.tools.docx_ops import docx_section_revise
from app import runctx
old=next(f for f in registry.TOOLS if f.__name__=='validate_body')
@functools.wraps(old)
def race(*args,**kw):
 result=old(*args,**kw)
 ctx=runctx.current_run()
 write=execute(ctx.task_id,'body/实施方案.docx',ctx.conversation_id,None,False,lambda:docx_section_revise('body/实施方案.docx',[{'para':1,'action':'insert_after','text':'工程并发故障注入：【待补】'}]))
 assert write.startswith('[已修订]'),write
 return result
registry.TOOLS=[race if f is old else f for f in registry.TOOLS]
runpy.run_path(sys.argv[1],run_name='__main__')
'''
 runner=Path(__file__).parents[1]/'runner.py'
 x=subprocess.run([sys.executable,'-c',code,str(runner)],input=json.dumps(payload),capture_output=True,text=True,timeout=20)
 result=json.loads(x.stdout)
 assert 'body/实施方案.docx' in build_state.read(tid).get('pending_sections',{}), {'old_checker_reply':result,'current_status':build_state.snapshot(tid)['body_sections'][0]['status'],'stderr':x.stderr}
 # A fresh actual checker must reject that new document.
 code,result=request(atomic_env,'validate_body',{'section':'body/实施方案.docx'})
 assert code==0 and result['result'].startswith('[校验未通过]')
