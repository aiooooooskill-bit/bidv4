import json
from PIL import Image
from app import db,company_store as cs,runctx
from app.knowledge import store,ingest,materials_lib as mlib
from app.tools.search_knowledge import search_company_assets,search_references

def test_extraction_metadata_and_images_are_searchable(tmp_path,monkeypatch):
    monkeypatch.setenv("DATA_DIR",str(tmp_path));db.init_db();store.ensure_dirs()
    name="营业执照.png";Image.new("RGB",(300,300)).save(store.kb_files_dir()/name)
    item=db.kb_insert_item(file_name=name,file_hash="fixture",title="营业执照",ext=".png")
    md,outline,_,_=store.kb_parse_paths(name);md.parent.mkdir(parents=True);md.write_text("# 公司\n企业许可数据\n");outline.write_text("[]")
    images=store.kb_images_dir(name);images.mkdir();Image.new("RGB",(300,300)).save(images/"page-1.png")
    ingest.finish(item["id"],{"doc_type":"business_license","statement":"营业执照与统一社会信用代码及企业成立日期均已整理成当前资料供工程检索验证。","questions":["公司执照在哪里"],"fields":{},"extra":{}})
    from app.services import company_library as lib,bidder
    import asyncio
    c=asyncio.run(lib.save_company(lib.CompanyBody(name='验证公司',profile={'legal_name':'法人'})))
    task=db.create_task('验证');cs.attach_asset(item['id'],c['id'])
    asyncio.run(bidder.save_bidder(task['id'],bidder.BidderBody(company_id=c['id'],signer_id='legal',sign_date='2026-10-12')))
    runctx.set_run('fixture','fixture',task['id'])
    result=search_company_assets("公司执照")
    assert "page-1.png" in result and "营业执照.png/images/" in result
    assert "read_company_asset" in result and "AI整理" in result
    assert "信息待确认" not in result

def test_material_search_points_to_actual_parse_root(tmp_path,monkeypatch):
    monkeypatch.setenv("DATA_DIR",str(tmp_path));db.init_db();mlib.ensure_dirs()
    path=mlib.mt_files_dir()/"素材.md";path.write_text("# 运行维护\n\n运维能力说明与工程案例。"*15)
    item=db.mt_insert_file(file_name=path.name,file_hash="fixture");mlib.run_parse(item["id"])
    mlib.create_block(item["id"],"运维能力说明","",ranges=[[1,12]])
    result=search_references("运维能力说明")
    assert "mt:" in result and str(mlib.mt_parse_dir("")) in result
    assert "read_file" not in result
