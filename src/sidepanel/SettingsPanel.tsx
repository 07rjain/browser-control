import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const tabs = [
  { id: "general", label: "General" },
  { id: "models", label: "Models" },
  { id: "agent", label: "Agent" },
  { id: "skills", label: "Skills" },
  { id: "account", label: "Account" },
] as const;
type Section = typeof tabs[number]["id"];

interface Props {
  onClose: () => void;
  sections: Record<Section, ReactNode>;
}

export default function SettingsPanel({ onClose, sections }: Props) {
  const [selected, setSelected] = useState<Section>("general");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current!;
    const returnFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);

  const select = (section: Section) => {
    setSelected(section);
    bodyRef.current?.scrollTo({ top: 0 });
  };

  return <dialog className="menu-card settings-panel" ref={dialogRef} aria-labelledby={`${id}-title`} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="settings-heading">
      <h2 id={`${id}-title`}>Settings</h2>
      <button type="button" className="settings-close" aria-label="Close settings" onClick={onClose} autoFocus>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </div>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {tabs.map((tab, index) => <button key={tab.id} ref={(element) => { tabRefs.current[index] = element; }} type="button" role="tab" id={`${id}-${tab.id}-tab`} aria-controls={`${id}-${tab.id}-panel`} aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1} onClick={() => select(tab.id)} onKeyDown={(event) => {
        let next: number;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault(); select(tabs[next].id); tabRefs.current[next]?.focus();
      }}>{tab.label}</button>)}
    </div>
    <div className="settings-body" ref={bodyRef}>
      {tabs.map((tab) => <section key={tab.id} role="tabpanel" id={`${id}-${tab.id}-panel`} aria-labelledby={`${id}-${tab.id}-tab`} hidden={selected !== tab.id} tabIndex={0}>
        {sections[tab.id]}
      </section>)}
    </div>
  </dialog>;
}
