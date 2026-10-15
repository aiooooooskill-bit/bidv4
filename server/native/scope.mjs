// Business agents use the host's official session lifecycle, persistence and UI.
// A child plugin owns registrations and handles; unloading it leaves the host alive.
export async function createBusinessScope(parent){
 const ready=Promise.withResolvers();
 const fiber=parent.plugin({name:'ooo-bidpliot-business-scope',apply(ctx){ready.resolve(ctx)}});
 const ctx=await ready.promise;
 return {ctx,close:async()=>{await fiber.dispose();while(fiber.inertia)await fiber.inertia}};
}
