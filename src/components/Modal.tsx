import { useEffect, useRef, type ReactNode } from "react";

const stack: HTMLElement[] = [];
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length>0&&!el.closest('[inert]'));

export function Modal({ open, onClose, children, width, label, role="dialog", priority=false }: {
  open: boolean; onClose: () => void; children: ReactNode; width?: string;
  label?: string; role?: 'dialog'|'alertdialog'; priority?: boolean;
}) {
  const panel=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(() => {
    if (!open || !panel.current) return;
    const root=panel.current, previous=document.activeElement as HTMLElement|null;
    if(priority)stack.push(root);else{const top=stack.findIndex(el=>el.dataset.feedback==='true');if(top<0)stack.push(root);else stack.splice(top,0,root);}
    const initial=root.querySelector<HTMLElement>('[data-modal-autofocus]')??focusables(root)[0]??root;
    if(stack.at(-1)===root)initial.focus();
    const onKey = (e: KeyboardEvent) => {
      if(stack.at(-1)!==root)return;
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close.current();}
      if(e.key==='Tab'){
        const items=focusables(root),first=items[0],last=items.at(-1);
        if(!first){e.preventDefault();root.focus();return;}
        if(e.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){e.preventDefault();last!.focus();}
        else if(!e.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){e.preventDefault();first.focus();}
      }
    };
    const onFocus=(e:FocusEvent)=>{if(stack.at(-1)===root&&!root.contains(e.target as Node))(focusables(root)[0]??root).focus();};
    window.addEventListener("keydown", onKey,true);document.addEventListener('focusin',onFocus);
    return () => {
      window.removeEventListener("keydown", onKey,true);document.removeEventListener('focusin',onFocus);
      stack.splice(stack.indexOf(root),1);
      if(previous?.isConnected)previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="bp-modal-mask" data-feedback={priority} onClick={()=>{if(stack.at(-1)===panel.current)close.current();}}>
      <div ref={panel} data-feedback={priority} className="bp-modal" role={role} aria-modal="true" aria-label={label} tabIndex={-1} style={{ width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
