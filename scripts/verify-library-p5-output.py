"""Inspect actual downloaded Word packages and retained real-model tool events."""
import hashlib,json,re,sys
from pathlib import Path
from collections import Counter
from zipfile import ZipFile
from lxml import etree
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'business/python'))
from app.tools.docx_ops import _accepted_text
evidence=root/'docs/evidence/library-p5-20261012'
report=json.loads((evidence/'report.json').read_text())
assert report.get('completed'),report.get('error','完整流程仍在运行')
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def inspect(file):
    with ZipFile(file) as z:
        xml=etree.fromstring(z.read('word/document.xml'))
        text='\n'.join(_accepted_text(p) for p in xml.findall('.//w:p',ns))
        media={hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('word/media/')}
        return {'name':file.name,'text':text,'tables':len(xml.findall('.//w:tbl',ns)),'images':len(media),'media':media,'tracked_changes':len(xml.findall('.//w:ins',ns))+len(xml.findall('.//w:del',ns))}
volumes=[inspect(f) for f in evidence.glob('验收演示-*.docx')]
assert volumes,'没有实际下载的合册 DOCX'
text='\n'.join(v['text'] for v in volumes)
identity=report['finalState']['bidder']['snapshot']
expected={'公司名称':identity['company']['name'],'通讯地址':identity['company']['profile']['address'],'联系电话':identity['company']['profile']['phone'],'传真':'无','邮箱':identity['company']['profile']['email'],'签字代表':identity['signer']['name'],'代表职务':identity['signer']['title']}
checks={label:bool(value in text) for label,value in expected.items()}
letter=inspect(evidence/'work/body/投标函.docx')
checks.update({'投标函 '+label:bool(value in letter['text']) for label,value in expected.items()})
checks['投标函范围正确']='致：江西省永晋招标咨询有限公司' in letter['text'] and len(letter['text'])<6000
checks['投标函没有重复副本']=letter['text'].count('致：江西省永晋招标咨询有限公司')==1
signature=next((line for line in letter['text'].splitlines() if '（签字或盖章）' in line and '法定代表人' in line),'')
checks['投标函签字栏使用确认代表']=identity['signer']['name'] in signature
checks['签署日期']=bool(re.search(r'2026\s*(?:年|[-/])\s*0?8\s*(?:月|[-/])\s*19',text))
checks['演示标记']='验收演示' in text
checks['修订后的双人复核']='双人复核' in text
checks['合册没有未接受修订']=all(v['tracked_changes']==0 for v in volumes)
checks['所有目录正文就绪']=all(s['status']=='ready' for s in report['finalState']['body_sections'])
checks['所有合册就绪']=all(v['status']=='ready' for v in report['finalState']['volume_states'])
material=inspect(root/'data/workspace/materials/files/服务方案.docx')
checks['表格保留']=sum(v['tables'] for v in volumes)>0
checks['实际素材图片保留']=bool(set().union(*(v['media'] for v in volumes)) & material['media']) if material['media'] else True
calls=Counter();results=[]
for file in (evidence/'sessions').rglob('session.v4.jsonl'):
    for line in file.read_text().splitlines():
        event=json.loads(line)
        if event.get('type')=='tool/call':calls[event['data']['name']]+=1
        if event.get('type')=='tool/result':
            for block in event.get('data',{}).get('message',{}).get('content',[]):
                if block.get('type')=='text':results.append(block['text'])
for tool in ['search_references','docx_material_inject','docx_section_revise','check_name_residue','validate_body','docx_assemble_volume']:
    checks['实际调用 '+tool]=calls[tool]>0
checks['素材注入成功']=any(s.startswith('[已注入]') and '素材原件' in s for s in results)
baseline=json.loads((evidence/'before-revise-hashes.json').read_text())
selected=next(s['title'] for s in report['finalState']['body_sections'] if re.search('技术|方案',s['title']))
changed=[name for name,digest in baseline['hashes'].items() if hashlib.sha256((evidence/'work/body'/name).read_bytes()).hexdigest()!=digest]
checks['单章修订不改其他正文']=len(changed)==1 and changed[0]==selected.replace('/',' ')+'.docx'
summary={'passed':all(checks.values()),'checks':checks,'volumes':[{k:v for k,v in x.items() if k not in ('text','media')} for x in volumes],'tools':dict(calls),'identityMode':report['identityMode'],'limitations':'真实文件与真实模型流程验收；主体、人员、联系方式及项目承诺为明确演示值，不是正式投标事实。'}
(evidence/'acceptance.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
report['acceptance']=summary['passed']
if not summary['passed']:
    report['completed']=False
    report['error']='实际 DOCX 验收未通过：'+'、'.join(k for k,v in checks.items() if not v)
(evidence/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False,indent=2))
assert summary['passed'],'实际 DOCX 验收存在未通过项，详见 acceptance.json'
