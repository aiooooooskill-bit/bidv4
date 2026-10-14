"""LingYan conversion and evidence files; dsh owns every vision request."""
from pathlib import Path
import json
from datetime import datetime,timezone
from PIL import Image
from .parse import convert,outline_with_lines,count_nodes,sha256_file,write_atomic
from .parse.pdf import render_page_png,insert_page_text
from .parse.image import IMAGE_EXTS,_TRANSCRIBE_PROMPT

def prepare(src,out):
    src=Path(src);out=Path(out);out.mkdir(parents=True,exist_ok=True)
    digest=sha256_file(src);paths=[out/(src.name+s) for s in ['.md','.outline.json','.meta.json']]
    if all(p.is_file() for p in paths) and json.loads(paths[2].read_text()).get('sha256')==digest:
        return {'cached':True,'paths':[str(p) for p in paths],'meta':json.loads(paths[2].read_text())}
    pages=[]
    if src.suffix.lower() in IMAGE_EXTS:
        md='';info={'conversion':'vision','pages':1,'tables':0};scan=[1]
    else:
        result=convert(src);md=result.md;info=result.info;scan=info.get('scanned_pages',[])
    for page in scan:
        image=out/'images'/f'page-{page}.png';image.parent.mkdir(parents=True,exist_ok=True)
        pages.append({'page':page,'path':str(image)})
    info_stat=src.stat()
    plan={'source':str(src),'out':str(out),'sha256':digest,'source_stat':[info_stat.st_size,info_stat.st_mtime_ns],'md':md,'info':info,'pages':pages}
    write_atomic(out/'plan.json',json.dumps(plan,ensure_ascii=False))
    if not pages:return finish(plan,[])
    return {'needs_ocr':True,'pages':pages,'prompt':_TRANSCRIBE_PROMPT,'plan':str(out/'plan.json')}

def render_ocr_page(plan,page):
    plan=json.loads(Path(plan).read_text())
    src=Path(plan['source']);info=src.stat()
    if [info.st_size,info.st_mtime_ns]!=plan['source_stat']:raise ValueError('来源文件已变化，请重新解析')
    item=next((p for p in plan['pages'] if p['page']==page),None)
    if item is None:raise ValueError('页面不属于本次OCR计划')
    image=Path(item['path'])
    if src.suffix.lower()=='.pdf':render_page_png(src,page,image,dpi=150)
    else:
        with Image.open(src) as im:
            if im.width*im.height>20_000_000:raise ValueError('图片超过2000万像素处理预算，请降低分辨率后重试')
            im.seek(0);im.convert('RGB').save(image)
    with Image.open(image) as im:
        if im.width*im.height>20_000_000:raise ValueError('图片超过2000万像素处理预算，请降低分辨率后重试')
    return item

def finish(plan,outputs):
    if isinstance(plan,str):plan=json.loads(Path(plan).read_text())
    src=Path(plan['source']);out=Path(plan['out'])
    if sha256_file(src)!=plan['sha256']:raise ValueError('来源文件已变化，请重新解析')
    expected=[p['page'] for p in plan['pages']]
    if [p['page'] for p in outputs]!=expected or any(not p['text'].strip() for p in outputs):raise ValueError('OCR页面未完整返回，本次解析未完成')
    md=plan['md'];info=plan['info']
    for p in outputs:
        md=insert_page_text(md,p['page'],p['text']) if src.suffix.lower()=='.pdf' else p['text']
    if outputs:info={**info,'conversion':'pdf-mixed' if src.suffix.lower()=='.pdf' else 'vision','ocr_pages':expected}
    if len(md.strip())<100:raise ValueError('解析内容不足100字符，无法继续；请检查文件是否完整')
    outline=outline_with_lines(md)
    meta={'source':src.name,'sha256':plan['sha256'],'bytes':src.stat().st_size,'chars':len(md),'headings':count_nodes(outline),'generated_at':datetime.now(timezone.utc).isoformat(timespec='seconds'),**info}
    paths=[out/(src.name+s) for s in ['.md','.outline.json','.meta.json']]
    for p,text in zip(paths,[md,json.dumps(outline,ensure_ascii=False,indent=2),json.dumps(meta,ensure_ascii=False,indent=2)]):write_atomic(p,text)
    return {'paths':[str(p) for p in paths],'meta':meta}
