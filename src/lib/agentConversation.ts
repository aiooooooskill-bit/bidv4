export const AGENT_OPEN_EVENT='ooo-bidpliot:open-agent-conversation';
export function openAgentConversation(sessionId:string){window.dispatchEvent(new CustomEvent(AGENT_OPEN_EVENT,{detail:{sessionId}}))}
