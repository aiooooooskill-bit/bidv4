import json
import subprocess
import sys
from pathlib import Path
import pytest
from docx import Document
from app import config
from app.services import build_state
from tests.test_section_write_atomicity import env, request


def stale(env):
 tid,root,_=env
 (root/'body/写作指引.md').write_text('| 节 | 模式 | 依据 | 素材 | 图示 | 缺口/备注 |\n|---|---|---|---|---|---|\n| 实施方案 | 推理撰写 | — | — | — | 当前规划 |')
 (root/'body/关键事实与承诺.md').write_text('| 事项 | 值 | 说明 |\n|---|---|---|\n| 项目事实 | 已确认 | |')
 for stage in ['guide','promises']:build_state.record_preparation(tid,stage)
 build_state.record_write(tid,'body/实施方案.docx','parent');build_state.record_validation(tid,'body/实施方案.docx')
 guide=root/'body/写作指引.md';guide.write_text(guide.read_text().replace('当前规划','当前规划已复核'))
 for stage in ['guide','promises']:build_state.record_preparation(tid,stage)
 assert build_state.snapshot(tid)['body_sections'][0]['status']=='stale'
 return root/'body/实施方案.docx'


def action(env,**changes):
 tid,_,_=env;p=config.data_dir()/'actions'/tid/'latest.json';p.parent.mkdir(parents=True,exist_ok=True)
 value={'action_id':'test-action','task_id':tid,'session_id':'parent','kind':'revise','section_paths':['body/实施方案.docx']};value.update(changes);p.write_text(json.dumps(value));return p


def rpc(env,session='parent'):
 tid,root,_=env
 payload={'operation':'tool','args':{'name':'validate_body','parameters':{'section':'./body/实施方案.docx'}},'data_root':str(config.data_dir()),'task_id':tid,'session_id':session,'call_id':'review-existing'}
 x=subprocess.run([sys.executable,str(Path(__file__).parents[1]/'runner.py')],input=json.dumps(payload),text=True,capture_output=True,timeout=15)
 return x.returncode,json.loads(x.stdout)


@pytest.mark.parametrize("metadata",[{}, {"outcome":None}])
def test_active_explicit_revise_can_accept_unchanged_checked_document(env,metadata):
 p=stale(env);before=p.read_bytes();action(env,**metadata);code,result=rpc(env)
 assert code==0 and result['result'].startswith('[校验通过]'),result
 assert build_state.snapshot(env[0])['body_sections'][0]['status']=='ready'
 assert p.read_bytes()==before
 ledger=(env[1]/'body/.build-state.json').read_bytes();rpc(env);assert (env[1]/'body/.build-state.json').read_bytes()==ledger


def test_active_assigned_child_can_accept_unchanged_checked_document(env):
 p=stale(env);before=p.read_bytes();latest=action(env);writers=latest.parent/'writers';writers.mkdir();(writers/'child.json').write_text(json.dumps({'action_id':'test-action','parent_id':'parent','section_paths':['body/实施方案.docx'],'status':'active'}))
 code,result=rpc(env,'child');assert code==0,result
 assert build_state.snapshot(env[0])['body_sections'][0]['status']=='ready';assert p.read_bytes()==before


@pytest.mark.parametrize('metadata',[None,{'outcome':{'state':'completed'}},{'stopped_at':1},{'kind':'build'},{'section_paths':[]}])
def test_ordinary_closed_stopped_build_or_unselected_check_does_not_adopt(env,metadata):
 p=stale(env);before=p.read_bytes()
 if metadata is not None:action(env,**metadata)
 ledger=(env[1]/'body/.build-state.json').read_bytes();rpc(env)
 assert build_state.snapshot(env[0])['body_sections'][0]['status']=='stale'
 assert p.read_bytes()==before and (env[1]/'body/.build-state.json').read_bytes()==ledger


def test_unassigned_child_does_not_adopt(env):
 stale(env);action(env);rpc(env,'unassigned-child');assert build_state.snapshot(env[0])['body_sections'][0]['status']=='stale'


def test_changed_adopted_source_cannot_be_silently_accepted(env):
 p=stale(env);action(env);before=p.read_bytes();ledger=(env[1]/'body/.build-state.json').read_bytes();env[2].write_bytes(b'changed-reference')
 code,result=rpc(env);assert code!=0 and '参考来源发生变化' in result['error'],result
 assert p.read_bytes()==before and (env[1]/'body/.build-state.json').read_bytes()==ledger


def test_failed_content_check_never_adopts_or_rewrites(env):
 p=stale(env);action(env);doc=Document(p);doc.add_paragraph('联系人：【待补】');doc.save(p);before=p.read_bytes();ledger=(env[1]/'body/.build-state.json').read_bytes()
 code,result=rpc(env);assert code==0 and result['result'].startswith('[校验未通过]')
 assert p.read_bytes()==before and (env[1]/'body/.build-state.json').read_bytes()==ledger


def test_document_changed_during_check_is_not_adopted(env):
 from app.services.section_revalidation import capture, accept
 p=stale(env);action(env);captured=capture(env[0],'parent','body/实施方案.docx');ledger=(env[1]/'body/.build-state.json').read_bytes()
 doc=Document(p);doc.add_paragraph('外部修改');doc.save(p);actual=p.read_bytes()
 with pytest.raises(ValueError,match='原稿或依据已变化'):accept(env[0],'parent','body/实施方案.docx',captured)
 assert p.read_bytes()==actual and (env[1]/'body/.build-state.json').read_bytes()==ledger


def test_stopped_action_during_check_is_not_adopted(env):
 from app.services.section_revalidation import capture, accept
 p=stale(env);action(env);captured=capture(env[0],'parent','body/实施方案.docx');ledger=(env[1]/'body/.build-state.json').read_bytes();before=p.read_bytes();action(env,stopped_at=1)
 with pytest.raises(ValueError,match='动作'):accept(env[0],'parent','body/实施方案.docx',captured)
 assert p.read_bytes()==before and (env[1]/'body/.build-state.json').read_bytes()==ledger


@pytest.mark.parametrize('kind',['revise','body','build'])
def test_current_action_proof_requires_actual_check_and_current_file(env,kind):
 from app.services import section_revalidation
 p=stale(env)
 # Set up an already-ready old document without a current-action proof.
 build_state.record_write(env[0],'body/实施方案.docx','parent')
 build_state.record_validation(env[0],'body/实施方案.docx')
 action(env,kind=kind)
 assert build_state.snapshot(env[0])['body_sections'][0]['validated_action_ids'] == []
 original=p.read_bytes();code,response=rpc(env);assert code==0,response
 current=build_state.snapshot(env[0])['body_sections'][0]
 assert current['validated_action_ids']==['test-action'] and current['status']=='ready'
 assert p.read_bytes()==original
 # Ledger is persistent, not process/session memory; an external changed file invalidates it.
 assert build_state.read(env[0])['section_validations']['body/实施方案.docx']['action_ids']==['test-action']
 doc=Document(p);doc.add_paragraph('工程外部变更');doc.save(p)
 assert build_state.snapshot(env[0])['body_sections'][0]['validated_action_ids'] == []


def test_unassigned_stopped_or_previous_action_never_supplies_current_proof(env):
 p=stale(env);build_state.record_write(env[0],'body/实施方案.docx','parent');build_state.record_validation(env[0],'body/实施方案.docx')
 action(env);code,result=rpc(env,'unassigned-child');assert code==0,result
 assert not build_state.snapshot(env[0])['body_sections'][0]['validated_action_ids']
 action(env,stopped_at=1);rpc(env)
 assert not build_state.snapshot(env[0])['body_sections'][0]['validated_action_ids']
 action(env);rpc(env);action(env,action_id='next-action')
 assert build_state.snapshot(env[0])['body_sections'][0]['validated_action_ids']==['test-action']
 # A real check in the next action replaces proof; no DOCX mutation is required.
 code,result=rpc(env);assert code==0,result
 assert build_state.snapshot(env[0])['body_sections'][0]['validated_action_ids']==['test-action','next-action']


@pytest.mark.parametrize('session',['parent','child'])
def test_retained_validation_proof_binds_basis_after_attaching_new_actual_reference(env,session):
 from app import artifact_store
 from app.services import source_usage,page_flow
 p=stale(env);before=p.read_bytes();latest=action(env)
 if session=='child':
  writers=latest.parent/'writers';writers.mkdir();(writers/'child.json').write_text(json.dumps({'action_id':'test-action','parent_id':'parent','section_paths':['body/实施方案.docx'],'status':'active'}))
 reference=artifact_store.sources_dir(env[0])/'核验中新读到的依据.docx';reference.write_bytes(b'actual-second-reference')
 source_usage.record_read(env[0],session,{'name':reference.name,'sha256':page_flow.file_hash(reference)})
 previous_basis=build_state.section_basis(env[0],build_state.sections(env[0])[0]);code,response=rpc(env,session);assert code==0,response
 value=build_state.read(env[0]);current=build_state.snapshot(env[0])['body_sections'][0]
 assert current['status']=='ready' and current['validated_action_ids']==['test-action']
 assert value['sections']['body/实施方案.docx']!=previous_basis
 assert value['section_validations']['body/实施方案.docx']['basis']==value['sections']['body/实施方案.docx']
 assert value['source_dependencies']['body/实施方案.docx'][reference.name]==page_flow.file_hash(reference)
 assert p.read_bytes()==before
 ledger=(env[1]/'body/.build-state.json').read_bytes();rpc(env,session);assert (env[1]/'body/.build-state.json').read_bytes()==ledger


@pytest.mark.parametrize('session',['parent','child'])
def test_newly_read_reference_change_does_not_gain_retained_proof_or_change_ledger(env,session):
 from app import artifact_store
 from app.services import source_usage,page_flow
 p=stale(env);before=p.read_bytes();latest=action(env)
 if session=='child':
  writers=latest.parent/'writers';writers.mkdir();(writers/'child.json').write_text(json.dumps({'action_id':'test-action','parent_id':'parent','section_paths':['body/实施方案.docx'],'status':'active'}))
 reference=artifact_store.sources_dir(env[0])/'核验中新读到的依据.docx';reference.write_bytes(b'actual-second-reference')
 source_usage.record_read(env[0],session,{'name':reference.name,'sha256':page_flow.file_hash(reference)})
 reference.write_bytes(b'changed-after-read');ledger=(env[1]/'body/.build-state.json').read_bytes();code,response=rpc(env,session)
 assert code!=0 and '参考来源发生变化' in response['error'],response
 assert p.read_bytes()==before and (env[1]/'body/.build-state.json').read_bytes()==ledger
 assert not build_state.snapshot(env[0])['body_sections'][0]['validated_action_ids']
