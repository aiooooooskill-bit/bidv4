// Only suppress an exact batch whose full receipt is still in the active surface.
// Compacted/pruned receipts and changed evidence must be read again in full.
export function reviewBatchResult(batch,messages){
 if(!batch.batch_id||!batch.requirements)return batch;
 const expected=JSON.stringify(batch);
 for(const message of messages){
  if(message.role!=='tool')continue;
  for(const block of message.content){
   if(block.type!=='text'||!block.text.includes('"saved"')||!block.text.includes('"next"'))continue;
   let receipt;try{receipt=JSON.parse(block.text)}catch{continue}
   if(receipt.saved===true&&JSON.stringify(receipt.next)===expected)return {
    batch_id:batch.batch_id,already_in_context:true,
    instruction:'直接使用当前上下文中save_review_batch回执的next。',
   };
  }
 }
 return batch;
}
