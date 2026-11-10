import {useEffect, useRef} from 'react';
import {ArrowLeft, Check, LoaderCircle, Vote} from 'lucide-react';

export function Confirmation({student, professor, busy, error, onClose, onConfirm}: {
  student?: string; professor: string; busy: boolean; error: string;
  onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="confirmation" aria-labelledby="confirmation-title"
    onCancel={event => {event.preventDefault(); if (!busy) onClose();}}>
    <span className="feature-icon"><Vote size={24}/></span>
    <h2 id="confirmation-title">Confirma tu voto</h2>
    <dl className="confirmation-summary">
      {student && <div><dt>Alumno</dt><dd>{student}</dd></div>}
      <div><dt>Candidato</dt><dd>{professor}</dd></div>
    </dl>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button type="button" className="button secondary" disabled={busy} onClick={onClose} autoFocus><ArrowLeft size={20}/> Volver</button>
      <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>
        {busy ? <LoaderCircle className="spin" size={20}/> : <Check size={20}/>} Confirmar mi voto
      </button>
    </div>
  </dialog>;
}
