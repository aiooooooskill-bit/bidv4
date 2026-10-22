"""Read-only attribution of native tool traffic; never edits workflow results."""
import argparse
from collections import Counter
import json
from pathlib import Path


def arguments(call):
    value = call.get('arguments') or {}
    return json.loads(value) if isinstance(value, str) else value


def inspect(run):
    stages = {}
    for stage in ('analyse', 'outline', 'build', 'review'):
        requests = [r for r in run['requests'] if r['stage'] == stage]
        calls = [t for t in run['tools'] if t['stage'] == stage]
        plans = [t for t in calls if t['name'] == 'outline_plan']
        reads = [t for t in calls if t['name'] == 'read']
        signatures = Counter(json.dumps(arguments(t), ensure_ascii=False, sort_keys=True) for t in reads)
        identities = Counter(json.dumps({'name': t['name'], 'arguments': arguments(t)}, ensure_ascii=False, sort_keys=True) for t in calls)
        errors = [t for t in calls if t.get('is_error')]
        stages[stage] = {
            'requests': len(requests),
            'finish_reasons': dict(Counter(r.get('finish_reason', 'unfinished') for r in requests)),
            'output_budget_events': [{'request': r['request'], 'max_tokens': r.get('max_tokens'),
                                     'completion_tokens': r.get('usage', {}).get('completion_tokens'),
                                     'reasoning_tokens': r.get('usage', {}).get('completion_tokens_details', {}).get('reasoning_tokens')}
                                    for r in requests if r.get('finish_reason') == 'length'],
            'tools': len(calls),
            'tools_by_name': dict(Counter(t['name'] for t in calls)),
            'outline_operations': dict(Counter(arguments(t).get('operation', 'begin') for t in plans)),
            'outline_errors_by_operation': dict(Counter(arguments(t).get('operation', 'begin') for t in plans if t.get('is_error'))),
            'error_attempts': len(errors),
            'errors': [{'name': t['name'], 'seq': t['seq'], 'session_id': t['session_id'], 'message': t.get('error_text')} for t in errors],
            'repeated_identical_reads': [{'arguments': json.loads(s), 'count': n} for s, n in signatures.most_common() if n > 1],
            'repeated_identical_tool_calls': [{'call': json.loads(s), 'count': n} for s, n in identities.most_common() if n > 1],
            'note': 'An identical read may be legitimate after modification, context removal or a new child session; this is traffic attribution, not an automatic redundancy verdict.'
        }
    return {'variant': run['variant'], 'completed': run.get('completed'), 'stages': stages}


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('result', type=Path); p.add_argument('--output', type=Path, required=True)
    a = p.parse_args(); a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(inspect(json.loads(a.result.read_text())), ensure_ascii=False, indent=2) + '\n')
