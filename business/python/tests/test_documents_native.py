import json
from pathlib import Path
import pytest
from docx import Document
from PIL import Image
from reportlab.pdfgen import canvas
from app.document import prepare,finish,render_ocr_page

TEXT='本项目采购运行维护服务。供应商应提供项目团队、实施计划与应急响应机制，服务期限三年。招标要求与投标承诺均应逐项回应。'*4

def test_docx_cache_and_changed_source(tmp_path):
    src=tmp_path/'采购.docx';out=tmp_path/'parse';d=Document();d.add_heading('采购说明',1);d.add_paragraph(TEXT);d.save(src)
    result=prepare(src,out);assert len(result['paths'])==3
    assert prepare(src,out)['cached'] is True
    d.add_paragraph('补充来源说明');d.save(src);assert prepare(src,out)['meta']['sha256']!=result['meta']['sha256']

def test_docx_text_and_terminal_checks_do_not_read_binary_parts(tmp_path,monkeypatch):
    from zipfile import ZipFile
    from app.tools.validate_body import validate_docx_file
    src=tmp_path/'带图带批注.docx';image=tmp_path/'图.png'
    Image.new('RGB',(100,100),'white').save(image)
    d=Document();d.add_heading('服务说明',1);p=d.add_paragraph(TEXT)
    d.add_comment(p.runs[0],text='容量检查备注',author='工程测试')
    d.add_picture(str(image));d.add_table(rows=1,cols=1).cell(0,0).text='表格承诺'
    d.save(src)
    read=ZipFile.read
    def read_metadata(self,name,*args,**kw):
        assert str(name).endswith('.rels') or not str(name).startswith('word/media/')
        return read(self,name,*args,**kw)
    monkeypatch.setattr(ZipFile,'read',read_metadata)
    result=prepare(src,tmp_path/'parse')
    assert result['meta']['image_count']==1
    md=Path(result['paths'][0]).read_text()
    assert '# 服务说明' in md and '表格承诺' in md and '![](图片)' in md
    assert any('容量检查备注' in n for n in validate_docx_file(src)[2])

@pytest.mark.parametrize('ext',['.png','.jpg','.jpeg','.gif','.webp'])
def test_image_uses_dsh_ocr_plan_and_keeps_original(tmp_path,ext):
    src=tmp_path/('采购'+ext);Image.new('RGB',(100,100),'white').save(src);original=src.read_bytes()
    result=prepare(src,tmp_path/'parse');assert result['needs_ocr'] and len(result['pages'])==1
    render_ocr_page(result['plan'],1)
    assert Path(result['pages'][0]['path']).suffix=='.png'
    with pytest.raises(ValueError,match='OCR页面未完整'):finish(result['plan'],[])
    completed=finish(result['plan'],[{'page':1,'text':TEXT}]);assert len(completed['paths'])==3;assert src.read_bytes()==original
    assert prepare(src,tmp_path/'parse')['cached']

def test_scanned_pdf_requires_every_page_in_order(tmp_path):
    src=tmp_path/'扫描.pdf';c=canvas.Canvas(str(src));c.showPage();c.showPage();c.save()
    result=prepare(src,tmp_path/'parse');assert [p['page'] for p in result['pages']]==[1,2]
    with pytest.raises(ValueError,match='OCR页面未完整'):finish(result['plan'],[{'page':2,'text':TEXT},{'page':1,'text':TEXT}])
    done=finish(result['plan'],[{'page':1,'text':TEXT},{'page':2,'text':TEXT}]);md=Path(done['paths'][0]).read_text();assert '<!-- p:1 -->' in md and '<!-- p:2 -->' in md
    assert done['meta']['ocr_pages']==[1,2]

def test_source_change_during_ocr_never_publishes(tmp_path):
    src=tmp_path/'采购.png';Image.new('RGB',(100,100)).save(src);out=tmp_path/'parse';p=prepare(src,out);src.write_bytes(b'changed')
    with pytest.raises(ValueError,match='来源文件已变化'):finish(p['plan'],[{'page':1,'text':TEXT}])
    assert not (out/(src.name+'.meta.json')).exists()

def test_mixed_pdf_keeps_digital_text_and_ocr_page(tmp_path):
    src=tmp_path/'混合.pdf';c=canvas.Canvas(str(src))
    for i in range(10):c.drawString(50,750-i*20,'Original digital procurement requirements '+str(i))
    c.showPage();c.showPage();c.save()
    result=prepare(src,tmp_path/'parse');assert [p['page'] for p in result['pages']]==[2]
    done=finish(result['plan'],[{'page':2,'text':TEXT}]);md=Path(done['paths'][0]).read_text()
    assert 'Original digital procurement requirements' in md and TEXT in md

def test_scan_over_128_pages_is_lazy_and_requires_complete_outputs(tmp_path):
    src=tmp_path/'长扫描.pdf';c=canvas.Canvas(str(src))
    for _ in range(129):c.showPage()
    c.save();out=tmp_path/'parse'
    result=prepare(src,out)
    assert len(result['pages'])==129
    assert not list((out/'images').glob('*.png'))
    render_ocr_page(result['plan'],129)
    assert list((out/'images').glob('*.png'))==[out/'images/page-129.png']
    outputs=[{'page':p,'text':TEXT} for p in range(1,130)]
    with pytest.raises(ValueError,match='OCR页面未完整'):finish(result['plan'],outputs[:-1])
    assert not (out/(src.name+'.meta.json')).exists()
    completed=finish(result['plan'],outputs)
    assert completed['meta']['ocr_pages']==list(range(1,130))
    assert '<!-- p:129 -->' in Path(completed['paths'][0]).read_text()

def test_image_budget_checked_before_conversion(tmp_path):
    src=tmp_path/'大图.png';Image.new('RGB',(5000,4001)).save(src);out=tmp_path/'parse'
    result=prepare(src,out)
    with pytest.raises(ValueError,match='2000万像素'):render_ocr_page(result['plan'],1)
    assert not (out/'images/page-1.png').exists()
