"""Read-only metrics and artifact checks for disposable full Package3 Flash runs."""
import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
from zipfile import ZipFile
from lxml import etree

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS={'w':W}
def load(path):
    return json.loads(path.read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def word(path):
    with ZipFile(path) as z:
        corrupt=z.testzip()
        root=etree.fromstring(z.read('word/document.xml'))
        for deleted in root.findall('.//w:del',NS):deleted.getparent().remove(deleted)
        paragraphs=[''.join(p.xpath('.//w:t/text()',namespaces=NS)) for p in root.findall('.//w:p',NS)]
        text='\n'.join(paragraphs)
        comments=etree.fromstring(z.read('word/comments.xml')) if 'word/comments.xml' in z.namelist() else None
        comment_rows=[] if comments is None else [{'id':e.get('{'+W+'}id'),'text':''.join(e.xpath('.//w:t/text()',namespaces=NS))} for e in comments]
        starts={e.get('{'+W+'}id') for e in root.findall('.//w:commentRangeStart',NS)}
        refs={e.get('{'+W+'}id') for e in root.findall('.//w:commentReference',NS)}
        ids={e['id'] for e in comment_rows}
        return {'path':str(path),'sha256':sha(path),'zip_valid':corrupt is None,'characters':len(text),'paragraphs':len(paragraphs),'tables':len(root.findall('.//w:tbl',NS)),'images':len([n for n in z.namelist() if n.startswith('word/media/')]),'comments':comment_rows,'comment_ids_without_anchors':sorted(ids-starts),'anchors_without_comments':sorted((starts|refs)-ids),'forbidden_body_placeholders':re.findall(r'【(?:待补|待澄清)[^】]*】',text),'text':text}
def stats(requests,tools,llm):
    used=[r for r in requests if r.get('usage')]
    return {'http_requests':len(requests),'llm_stream_calls':len(llm),'tool_calls':len(tools),'input_tokens':sum(r['usage']['prompt_tokens'] for r in used),'cached_tokens':sum(r['usage'].get('prompt_cache_hit_tokens',r['usage'].get('prompt_tokens_details',{}).get('cached_tokens',0)) for r in used),'output_tokens':sum(r['usage']['completion_tokens'] for r in used),'peak_input_tokens':max((r['usage']['prompt_tokens'] for r in used),default=0),'requests_without_usage':len(requests)-len(used),'http_errors':sum(r.get('status')!=200 for r in requests),'tool_errors':sum(bool(r.get('is_error')) for r in tools),'tool_names':dict(Counter(t.get('name','unknown') for t in tools))}


def user_preservation(root):
    humans = []; removed = []; compactions = Counter()
    for log in (root/'dsh-home/sessions').rglob('session.v4.jsonl.zstd'):
        rows = [json.loads(line) for line in subprocess.check_output(['zstd','-dc',str(log)]).splitlines()]
        shadowed = set()
        for row in rows:
            if row.get('type') == 'compaction/summary':
                data = row['data']; shadowed.update(data.get('shadowedSeqs', []))
                compactions[(data.get('provider'), data.get('model'))] += 1
        for row in rows:
            if row.get('type') == 'user/message' and row['data'].get('source', {}).get('kind') in ('human', 'user', 'user-question-reply'):
                item = {'session': log.parent.name, 'seq': row['seq']}; humans.append(item)
                if row['seq'] in shadowed: removed.append(item)
    return {'human_messages': len(humans), 'shadowed_human_messages': removed,
            'all_preserved_by_compaction': not removed,
            'compactions': [{'provider': p, 'model': m, 'count': n} for (p, m), n in compactions.items()],
            'method': 'Read actual compaction/summary.data.shadowedSeqs, not surfaceOp append markers; inspect all native sessions.'}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    base=args.root;fixture=load(base/'manifest.json');tid=fixture['task_id'];report={'method':'fresh real full native pipeline; same original tender, bidder and frozen library; official DeepSeek Flash only; two independent generation runs','variants':{},'fixture':fixture,'quality_scope':'existing native validators plus independent original-file, quote, comment and OOXML checks; factual/visual manual checks recorded separately'}
    for variant in ('before','after'):
        run=load(base/(variant+'-evidence/result.json'));root=base/variant;work=root/'data/workspace'/tid/'work'
        states={k:load(base/(variant+'-evidence')/(k+'-state.json')) for k in ('analyse','outline','build','review') if (base/(variant+'-evidence')/(k+'-state.json')).exists()}
        metrics=stats(run['requests'],run['tools'],run['llm_calls']);metrics['uncached_input_tokens']=metrics['input_tokens']-metrics['cached_tokens']
        stages={k:stats([r for r in run['requests'] if r['stage']==k],[t for t in run['tools'] if t['stage']==k],[c for c in run['llm_calls'] if c['stage']==k]) for k in ('analyse','outline','build','review')}
        assert all(r['model']=='deepseek-flash' and r['url']=='https://api.deepseek.com/chat/completions' and (not r.get('response_model') or r['response_model']=='deepseek-flash') for r in run['requests'])
        assert all(c['provider']=='flash-e2e' and c['model']=='deepseek-flash' for c in run['llm_calls'])
        source_hashes={name:sha(root/'data/workspace'/tid/'sources'/name) for name in fixture['fixture_files']};assert source_hashes==fixture['fixture_files']
        original_hashes={}
        for ident,item in fixture['library_original_hashes'].items():
            folder='knowledge' if ident.startswith('kb_') else 'materials';p=root/'data/workspace'/folder/'files'/item['file_name'];original_hashes[ident]=sha(p);assert original_hashes[ident]==item['sha256']
        docs=[word(p) for p in sorted((work/'body').rglob('*.docx'))];volumes=[d for d in docs if Path(d['path']).name.startswith('整本-')]
        for doc in docs:
            out=args.output/variant/'texts'/ (Path(doc['path']).stem+'.txt');out.parent.mkdir(parents=True,exist_ok=True);out.write_text(doc.pop('text'))
        archive_checks=[];session_events={}
        for path in (root/'data/actions'/tid).glob('*.json'):
            if path.name=='latest.json':continue
            action=load(path)
            for archive in action.get('stage_context',{}).get('archives',[]):
                p=Path(archive['path']);assert sha(p)==archive['sha256'];payload=load(p);sid=payload['source_session']
                if sid not in session_events:
                    log=next((root/'dsh-home/sessions').rglob(sid+'/session.v4.jsonl.zstd'))
                    rows=[json.loads(line) for line in subprocess.check_output(['zstd','-dc',str(log)]).splitlines()]
                    session_events[sid]={row['seq']:row for row in rows if 'seq' in row}
                exact=payload['events']==[session_events[sid].get(seq) for seq in payload['source_seqs']]
                archive_checks.append({'kind':action['kind'],'path':str(p),'sha256':archive['sha256'],'source_seqs':archive['source_seqs'],'hash_valid':True,'original_log_events_exact':exact})
        review=states.get('review',{}).get('review',{});envelope=review.get('report') or {};compiled=envelope.get('report') or {};catalog=envelope.get('analysis',{}).get('catalog',[])
        expected={c['id'] for c in catalog};actual=[r['id'] for r in compiled.get('requirements',[])];quotes_checked=0;quote_errors=[]
        documents={d['id']:d for d in envelope.get('documents',[])}
        for requirement in compiled.get('requirements',[]):
            for kind in ('tender','bid'):
                for e in requirement[kind]:
                    p=Path(documents[e['document_id']]['path']);expected_quote='\n'.join(p.read_text().splitlines()[e['start']-1:e['end']]);quotes_checked+=1
                    if e.get('quote')!=expected_quote:quote_errors.append({'id':requirement['id'],'kind':kind,'evidence':e})
        quality={'sources_unchanged':True,'library_originals_unchanged':True,'stage_completed':{s['kind']:s.get('completed') for s in run['stages']},'analysis_checks':[a.get('analysis_check') for s in run['stages'] if s['kind']=='analyse' for a in s['attempts']],'body_sections':states.get('build',{}).get('body_sections',[]),'volume_states':states.get('build',{}).get('volume_states',[]),'word_documents':docs,'whole_books':volumes,'archives':archive_checks,'review_status':review.get('status'),'review_completed':envelope.get('completed',False),'review_catalog_count':len(catalog),'reviewed_count':len(actual),'review_catalog_exactly_covered':set(actual)==expected and len(actual)==len(set(actual)) and bool(actual),'review_status_counts':dict(Counter(r['status'] for r in compiled.get('requirements',[]))),'issue_risk_counts':dict(Counter(i['risk_type'] for i in compiled.get('issues',[])+compiled.get('document_issues',[]))),'quotes_checked':quotes_checked,'quote_errors':quote_errors,'limitations':compiled.get('limitations',[]),'summary_items':compiled.get('summary_items',[]),'native_document_checks':envelope.get('checks',[])}
        quality['user_preservation'] = user_preservation(root)
        report['variants'][variant]={'completed':run.get('completed'),'failure':run.get('failure'),'totals':metrics,'stages':stages,'quality':quality,'started_at':run['started_at'],'finished_at':run['finished_at'],'elapsed_seconds':round((datetime.fromisoformat(run['finished_at'])-datetime.fromisoformat(run['started_at'])).total_seconds(),2)}
    before=report['variants']['before']['totals'];after=report['variants']['after']['totals'];report['relative_reduction']={k:1-after[k]/before[k] for k in ('input_tokens','uncached_input_tokens','http_requests','llm_stream_calls','tool_calls') if before[k]}
    (args.output/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({v:{'totals':r['totals'],'completed':r['completed'],'quote_errors':len(r['quality']['quote_errors'])} for v,r in report['variants'].items()},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
