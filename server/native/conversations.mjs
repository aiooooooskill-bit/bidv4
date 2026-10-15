// A project owns one native DSH conversation. Stage/action IDs are independent.
export const conversationTasks=new Map();
export function taskForAgent(agent){let current=agent;while(current){const tid=conversationTasks.get(current.id);if(tid)return tid;const parent=current.session?.header.parentSession;if(!parent)break;current=agent.ctx?.agents?.get(parent)}return undefined}
