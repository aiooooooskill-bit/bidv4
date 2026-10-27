import test from 'node:test';
import {runIsolatedTest} from './helpers/isolated-app.mjs';

test('单章准备、同会话问答、停止恢复、过期核对和写入守卫的真实HTTP工具链', {timeout:210000},()=>runIsolatedTest('experiments/preparation-flow.mjs','BIDV4_PREPARATION_FIXTURE',/隔离制作准备技术验证：auto/,200000));
