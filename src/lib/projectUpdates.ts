type SessionList = {
 getSnapshot:()=>{phase:string;ids:string[];byId:Record<string,{running:boolean;updatedAt:number}>};
 subscribe:(listener:()=>void)=>()=>void;
};
// Session projections also change for every streamed token and retention update.
// Only catalog/activity/execution changes need a business refresh; running work
// is polled by ProjectWorkbench independently.
export function startProjectUpdates(list:SessionList,notify:()=>void){
 const signature=()=>{const value=list.getSnapshot();return JSON.stringify([value.phase,value.ids.map(id=>[id,value.byId[id]?.running,value.byId[id]?.updatedAt])])};
 let previous=signature();
 return list.subscribe(()=>{const next=signature();if(next===previous)return;previous=next;notify()});
}
