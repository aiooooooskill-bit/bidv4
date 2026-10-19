import type {Flow,Execution} from '../src/api';
export function deliveryReady(flow:Flow):boolean;
export function actionSatisfied(flow:Flow,action:Pick<Execution,'kind'|'sections'|'created_at'>):boolean;
export const actionNames:Record<string,string>;
