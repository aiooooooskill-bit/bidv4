"""Replay confirmed Package 3 decisions with DeepSeek Flash in disposable data copies.

This measures tool execution/context transport, not a fresh semantic tender analysis.
Requires frozen case data and explicit before/after source roots. Never writes the source data.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--after', type=Path, required=True)
    parser.add_argument('--case', type=Path, required=True)
    parser.add_argument('--task-id', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--api-base', default='https://api.deepseek.com')
    parser.add_argument('--model', default='deepseek-flash')
    args = parser.parse_args()
    args.before, args.after, args.case = args.before.resolve(), args.after.resolve(), args.case.resolve()
    if args.model != 'deepseek-flash' or args.api_base.rstrip('/') != 'https://api.deepseek.com':
        parser.error('This verifier is restricted to the requested official DeepSeek Flash route')
    api_key = os.environ['BID_ROUND1_API_KEY']
    args.output.mkdir(parents=True, exist_ok=True)
    original_plan = json.loads((args.case / 'outline-runs' / (args.task_id + '.json')).read_text())['plan']
    decisions = original_plan['exclusions']
    report = {'method': 'real DeepSeek Flash / confirmed-decision replay / fresh identical histories',
              'quality_scope': 'source bindings, exclusions and reasons, original directory, freeze/check/publish gates; not new semantic drafting or auditing',
              'case_task_id': args.task_id, 'expected_exclusions': len(decisions), 'variants': {}}
    for variant, root in [('before', args.before), ('after', args.after)]:
        sandbox = Path(tempfile.mkdtemp(prefix='bidv4-round1-' + variant + '-'))
        data = sandbox / 'data'
        shutil.copytree(args.case, data)
        env = dict(os.environ, DSH_HOME=str(sandbox / 'dsh-home'), DSH_TELEMETRY_DISABLED='1')
        def business(operation, values, call_id='benchmark'):
            request = dict(operation=operation, args=values, data_root=str(data), task_id=args.task_id,
                           session_id='isolated-round1', call_id=call_id)
            p = subprocess.run([str(root / 'business/python/.venv/bin/python'), str(root / 'business/python/runner.py')],
                               input=json.dumps(request), capture_output=True, text=True, cwd=root, env=env, check=False)
            value = json.loads(p.stdout)
            if p.returncode or value.get('error'):
                raise RuntimeError(value.get('error') or p.stderr)
            return value['result']
        business('outline_begin', dict(task_id=args.task_id, action_id='isolated-round1'))
        tool_names = ['read_artifact', 'outline_plan', 'check_outline']
        schemas = [s for s in business('schemas', {}) if s['name'] in tool_names]
        tools = [{'type': 'function', 'function': {k:s[k] for k in ('name', 'description', 'parameters')}} for s in schemas]
        messages = [dict(role='system', content='你在隔离验收环境回放已确认的业务决定，不重新解读条款。严格按工具说明执行；每次最多4个工具调用。逐条复制给定source_id和各自的reason，理由逐字保留，不概括、不合并不同条目的理由。所有66项都必须保存，不能省略。先read_artifact默认视图读取当前目录一次，再outline_plan(begin)，完成全部排除后complete冻结，再check_outline，通过后简短报告。工具错误须修复，不得绕过校验。'),
                    dict(role='user', content='本次仅投包3。以下为已核实的排除决定，供原业务工具逐项验证并保存。完整目录保留原结构和说明，不改写文件。\n' + json.dumps(decisions, ensure_ascii=False))]
        trace, usages, calls = [], [], Counter()
        started = time.monotonic()
        checked = False
        for step in range(40):
            body = dict(model=args.model, messages=messages, tools=tools, temperature=0,
                        max_tokens=4096, stream=False)
            req = urllib.request.Request(args.api_base + '/chat/completions',
                data=json.dumps(body, ensure_ascii=False).encode(),
                headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key})
            with urllib.request.urlopen(req, timeout=360) as response:
                response = json.load(response)
            usage = response.get('usage', {})
            usages.append(usage)
            message = response['choices'][0]['message']
            messages.append({k:message[k] for k in ('role', 'content', 'tool_calls', 'reasoning_content') if k in message})
            step_calls = message.get('tool_calls', [])
            trace.append({'step': step, 'model': response.get('model'), 'usage': usage, 'tool_calls': step_calls})
            for call in step_calls:
                name = call['function']['name']
                if name not in tool_names:
                    raise RuntimeError('Unexpected tool: ' + name)
                params = json.loads(call['function']['arguments'])
                calls[name] += 1
                try:
                    result = business('tool', dict(name=name, parameters=params), call['id'])
                    checked = checked or (name == 'check_outline' and isinstance(result, dict) and result.get('ok'))
                except RuntimeError as error:
                    result = 'Error: ' + str(error)
                text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                messages.append(dict(role='tool', tool_call_id=call['id'], content=text))
                trace[-1].setdefault('results', []).append(dict(name=name, params=params, chars=len(text), result=result))
            (args.output / (variant + '-trace.json')).write_text(json.dumps(trace, ensure_ascii=False, indent=2))
            print(json.dumps(dict(variant=variant, step=step, prompt_tokens=usage.get('prompt_tokens'), calls=dict(calls))), flush=True)
            if not step_calls:
                if checked:
                    break
                messages.append(dict(role='user', content='尚未通过check_outline，继续完成剩余操作；不能提前结束。'))
        else:
            raise RuntimeError('Model did not finish within the step limit')
        plan = json.loads((data / 'outline-runs' / (args.task_id + '.json')).read_text())['plan']
        assert plan == original_plan, 'Confirmed plan, source mappings or exclusion reasons changed'
        quality = business('outline_check', dict(task_id=args.task_id))
        published = business('tool', dict(name='assemble_tender', parameters={}), 'publish')
        assert '[组装' in published and '失败' not in published, published
        work = data / 'workspace' / args.task_id / 'work'
        original = (args.case / 'workspace' / args.task_id / 'work/outline/tender-response-docs.md').read_bytes()
        assert (work / 'outline/tender-response-docs.md').read_bytes() == original
        report['variants'][variant] = dict(model=args.model, requests=len(usages), calls=dict(calls),
            tool_calls=sum(calls.values()), input_tokens=sum(u['prompt_tokens'] for u in usages),
            output_tokens=sum(u['completion_tokens'] for u in usages), peak_input_tokens=max(u['prompt_tokens'] for u in usages),
            cache_tokens=sum(u.get('prompt_tokens_details', {}).get('cached_tokens', 0) for u in usages),
            elapsed_seconds=round(time.monotonic() - started, 2), quality=quality,
            plan_identical=True, outline_bytes_identical=True, outline_sha256=hashlib.sha256(original).hexdigest(),
            exclusions=len(plan['exclusions']), sandbox=str(sandbox), published=published)
        (args.output / 'comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    before, after = report['variants']['before'], report['variants']['after']
    report['reduction'] = {key: 1 - after[key] / before[key] for key in ('input_tokens', 'tool_calls', 'requests')}
    (args.output / 'comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
