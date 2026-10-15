"""One business operation per process; no server, model client or Agent loop."""
import asyncio,base64,importlib,inspect,json,os,re,sys,typing
from pathlib import Path
from pydantic import BaseModel,TypeAdapter,create_model
request=json.load(sys.stdin);os.environ['DATA_DIR']=request['data_root']
from app import db,artifact_store,runctx,task_stage
from app.services.errors import BusinessError,FileDownload,IncomingFile,Response
from app.services import page_flow, build_state, review, review_batches
from app.tools import TOOLS
from app import document
from app.work_paths import normalize_work_path
ROUTES=json.loads((Path(__file__).parent/'app/services/routes.json').read_text())
TOOL_MAP={f.__name__:f for f in TOOLS}

def schemas():
    result=[]
    for name,f in TOOL_MAP.items():
        signature=inspect.signature(f);hints=typing.get_type_hints(f)
        fields={k:(hints.get(k,str),... if p.default is inspect.Parameter.empty else p.default) for k,p in signature.parameters.items()}
        schema=create_model(name,**fields).model_json_schema()
        result.append({'name':name,'description':inspect.getdoc(f) or name,'parameters':schema})
    return result

def state(tid):
    task=page_flow.require_task(tid);d=page_flow.directory(tid);work=artifact_store.work_dir(tid)
    return {'task':task_stage.enrich([task])[0],'files':page_flow.files(tid),'directory':d,'source_selection':page_flow.source_selection(tid),'body_files':[p.relative_to(work).as_posix() for p in work.joinpath('body').rglob('*.docx')], **build_state.snapshot(tid), 'bidder':__import__('app.services.bidder',fromlist=['status']).status(tid), 'review':review.snapshot(tid), 'input_versions':page_flow.input_versions(tid)}

def tool_context():
    runctx.set_run(request.get('session_id',''),request.get('call_id',''),request.get('task_id'))

async def dispatch():
    op=request['operation'];args=request.get('args',{})
    db.init_db()
    if op=='inherit_asset_reads':
        from app.services.asset_usage import inherit_reads
        inherit_reads(args['task_id'],args['session_id'],args['from_session_id'],args.get('seed',False));return {'ok':True}
    if op=='record_asset_read':
        from app.services.asset_usage import record_read
        record_read(args['task_id'],args['session_id'],args['asset']);return {'ok':True}
    if op=='schemas':return schemas()
    if op=='routes':return ROUTES
    if op=='asset_access':
        from app.company_store import require_asset_path
        asset=require_asset_path(args['task_id'],args['path']);return {'ok':True,'asset':asset}
    if op=='bidder_snapshot':
        from app.services.bidder import snapshot_for_task
        return snapshot_for_task(args['task_id'])
    if op=='review_prepare':return review.prepare(args['task_id'])
    if op=='review_documents':return {'documents':review.documents(args['task_id'])}
    if op=='review_progress':
        if not review_batches.path(args['task_id'],args['session_id']).is_file():return {'accepted':0,'batches':0,'total_batches':0}
        value,groups=review_batches.read(args['task_id'],args['session_id'])
        return {'accepted':sum(len(b['comparisons']) for b in value['batches']),'batches':len(value['batches']),'total_batches':len(groups)}
    if op=='review_accept_batch':return review_batches.accept(args['task_id'],args['session_id'],args['candidate'])
    if op=='review_finish':return review.finish(args['task_id'],args['session_id'])
    if op=='review_input':return review.set_input(args['task_id'],args['bids'])
    if op=='review_decide':return review.decide(args['task_id'],args['session_id'],args['issue_id'],args['status'],args['note'])
    if op=='analysis_source_version':return page_flow.analysis_source_version(args['task_id'])
    if op=='state':return state(args['task_id'])
    if op=='tasks':return {'tasks':task_stage.enrich(db.list_tasks())}
    if op=='create_task':
        import uuid
        tid='t_'+uuid.UUID(args['request_id']).hex;title=args['title'].strip()
        if not title:raise BusinessError(422,'任务名不能为空')
        task=db.get_task(tid)
        if task and task['title']!=title:raise BusinessError(409,'同一上传请求对应的项目名称已变化')
        task=task or db.create_task(title,task_id=tid);artifact_store.ensure_task_skeleton(tid)
        return {'task':task_stage.enrich([task])[0]}
    if op=='archive_task':
        tid=args['task_id'];page_flow.require_task(tid)
        if not artifact_store.archive_task(tid):raise BusinessError(409,'项目目录归档未完成')
        db.delete_task(tid);return {'ok':True}
    if op=='prepare':
        tid=args['task_id'];page_flow.require_task(tid);name=args['file_name']
        if Path(name).name!=name or name.startswith('.'):raise BusinessError(422,'来源文件名非法')
        return document.prepare(artifact_store.sources_dir(tid)/name,artifact_store.work_dir(tid)/'parse'/name)
    if op=='ocr_finish':return document.finish(args['plan'],args['outputs'])
    if op=='ocr_page':return document.render_ocr_page(args['plan'],args['page'])
    if op=='outline_options':
        target = args['page_target']
        numbering = args['numbering']
        if target is not None and (type(target) is not int or not 1 <= target <= 1000):
            raise BusinessError(422, '目标篇幅须为1–1000页或不限篇幅')
        if numbering not in ('chapter', 'decimal', 'gov', 'none'):
            raise BusinessError(422, '编号方式无效')
        artifact_store._atomic_write(artifact_store.work_dir(args['task_id']) / 'outline/.generation-options.json', json.dumps({'page_target': target, 'numbering': numbering}))
        return {'ok': True}
    if op=='accept_section':
        tid=args['task_id']
        from app.services.edit_guard import require_idle
        require_idle(tid)
        section=next((s for s in build_state.sections(tid) if s['volume']==args['volume'] and s['title']==args['title']), None)
        if not section or not (artifact_store.work_dir(tid)/section['path']).is_file():
            raise BusinessError(422, '当前章节没有正文文件')
        build_state.record_section(tid, section['path'])
        return {'ok': True}
    if op=='record_preparation':
        build_state.record_preparation(args['task_id'], args['stage'], args.get('session_id'))
        return {'ok': True}
    if op=='record_guide_write':
        build_state.record_guide_write(args['task_id'], args['previous_hash'], args['replace'])
        return {'ok': True}
    if op=='check_preparation_write':
        build_state.check_preparation_write(args['task_id'], args['stage'], args['content'])
        return {'ok': True}
    if op=='sources':
        return page_flow.set_sources(args['task_id'],args['main_file'],args['supplements'])
    if op=='tool':
        tool_context()
        parameters = args.get('parameters', {})
        writes_section = args['name'] in ('docx_section_create', 'docx_section_revise', 'docx_material_inject', 'docx_source_inject', 'docx_image_insert', 'docx_comment_add', 'docx_diagram_insert', 'docx_html_figure')
        if writes_section:
            key = 'path' if 'path' in parameters else 'dest'
            parameters[key] = normalize_work_path(parameters.get(key, ''))
        elif args['name'] == 'validate_body':
            parameters['section'] = normalize_work_path(parameters.get('section', 'body'))
        section_path = parameters.get('path', parameters.get('dest', '')) if writes_section else ''
        if section_path and not section_path.endswith('.docx'):
            section_path += '.docx'
        target = artifact_store.work_dir(request['task_id']) / section_path if section_path else None
        before = page_flow.file_hash(target) if target and target.is_file() else None
        result = TOOL_MAP[args['name']](**parameters)
        if args['name'] == 'finish_review_report':
            # Publish only after the existing complete-batch/report checks pass,
            # so the same Agent can read its final report before ending its reply.
            review.finish(request['task_id'], request['session_id'])
        if target and target.is_file() and page_flow.file_hash(target) != before:
            build_state.record_write(request['task_id'], section_path, request.get('session_id'), replace=args['name']=='docx_section_create')
        if args['name'] == 'validate_body' and str(result).startswith('[校验通过]'):
            section = args.get('parameters', {}).get('section', '')
            if section.endswith('.docx'):
                build_state.record_validation(request['task_id'], section)
        return result
    if op=='checks':
        tool_context();s=state(request['task_id']);return {'pipeline':TOOL_MAP['check_pipeline_state'](),'body':TOOL_MAP['validate_body'](section='body'),'has_body':bool(s['body_files']),'input_version':s['input_versions']['revise']}
    if op=='export':
        tool_context();result=TOOL_MAP['docx_assemble_volume']()
        if result.startswith(('[失败]','[错误]','[合册失败]')) or '未生成' in result:raise BusinessError(422,result)
        missing = [v['name'] for v in build_state.snapshot(request['task_id'])['volume_states'] if v['status'] != 'ready']
        if missing:
            raise BusinessError(422, '以下整册未完成生成或发布：' + '、'.join(missing))
        return {'result':result}
    if op=='dispatch_context':
        from app import dispatch_enrich
        return dispatch_enrich.build_enriched_description(args['description'],request['task_id'])
    if op=='render_pending':
        from app import render_queue
        return {'requests':render_queue.pending()}
    if op=='render_fulfill':
        from app import render_queue
        data=Path(args['file']).read_bytes() if args.get('file') else None
        if not render_queue.fulfill(args['request_id'],data):raise BusinessError(404,'插图请求已结束')
        return {'ok':True}
    if op=='kb_prepare':
        from app.knowledge import store
        item=db.kb_get_item(args['id'])
        if not item:raise BusinessError(404,'资料不存在')
        result=document.prepare(store.kb_files_dir()/item['file_name'],store.kb_parse_dir(item['file_name']))
        return {**result,'file_name':item['file_name']}
    if op=='kb_prompt':
        from app.knowledge import store,extract
        item=db.kb_get_item(args['id']);md=store.kb_parse_paths(item['file_name'])[0].read_text()
        return {'system':extract.EXTRACT_SYSTEM,'prompt':extract.build_extract_prompt(item['file_name'],md)}
    if op=='kb_finish':
        from app.knowledge.ingest import finish
        from app.knowledge import images,store
        item=db.kb_get_item(args['id'])
        if Path(item['file_name']).suffix.lower() in ('.docx','.pdf'):images.extract_images(store.kb_files_dir()/item['file_name'],item['file_name'])
        return finish(args['id'],args['metadata'])
    if op=='kb_fail':db.kb_update_item(args['id'],parse_status='failed',error=args['error']);return {'ok':True}
    if op=='kb_recover':
        item=db.kb_get_item(args['id'])
        if item and item['parse_status']=='pending':db.kb_update_item(args['id'],parse_status='failed',error='资料处理已中断，请重新解析')
        return {'ok':True}
    if op=='route':
        path=args['path'];method=args['method']
        for route in ROUTES:
            keys=re.findall(r'\{(\w+)\}',route['path']);match=re.fullmatch(re.sub(r'\{\w+\}',r'([^/]+)',route['path']),path)
            if route['method']!=method or not match:continue
            from urllib.parse import unquote
            params={**args.get('query',{}),**dict(zip(keys,map(unquote,match.groups())))}
            module=importlib.import_module('app.services.'+route['module']);f=getattr(module,route['function']);hints=typing.get_type_hints(f);kw={}
            for name,param in inspect.signature(f).parameters.items():
                annotation=hints.get(name,str)
                if annotation is IncomingFile:
                    if not args.get('upload'):raise BusinessError(422,'未提供文件')
                    kw[name]=IncomingFile(**args['upload'])
                elif name=='body':kw[name]=TypeAdapter(annotation).validate_python(args.get('body',{}))
                elif name in params:kw[name]=TypeAdapter(annotation).validate_python(params[name])
                elif param.default is inspect.Parameter.empty:raise BusinessError(422,'缺少参数：'+name)
            try:
                value=f(**kw);return await value if inspect.isawaitable(value) else value
            finally:
                for value in kw.values():
                    if isinstance(value,IncomingFile):await value.close()
        raise BusinessError(404,'操作不存在')
    raise BusinessError(404,'操作不存在')

def encode(value):
    if isinstance(value,BaseModel):return value.model_dump()
    if isinstance(value,FileDownload):return {'file_path':value.path,'file_name':value.filename,'media_type':value.media_type}
    if isinstance(value,Response):return {'bytes':base64.b64encode(value.content).decode(),'media_type':value.media_type}
    if isinstance(value,Path):return str(value)
    raise TypeError(type(value).__name__)
try:
    value=asyncio.run(dispatch());print(json.dumps({'result':value},ensure_ascii=False,default=encode))
except Exception as error:
    from pydantic import ValidationError
    print(json.dumps({'error':str(error),'status':error.status_code if isinstance(error,BusinessError) else 422 if isinstance(error,(ValueError,ValidationError)) else 500},ensure_ascii=False));sys.exit(1)
