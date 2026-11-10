import {useEffect, useRef} from 'react';
import {LoaderCircle, Vote} from 'lucide-react';

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
    <h2 id="confirmation-title">¿Estás seguro de tu elección?</h2>
    <dl className="confirmation-summary">
      {student && <div><dt>Alumno</dt><dd>{student}</dd></div>}
      <div><dt>Profesor seleccionado</dt><dd>{professor}</dd></div>
    </dl>
    <p>Una vez confirmado, no podrás modificar tu voto.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button type="button" className="button secondary" disabled={busy} onClick={onClose} autoFocus>Volver y corregir</button>
      <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>
        {busy && <LoaderCircle className="spin" size={17}/>} Confirmar mi voto
      </button>
    </div>
  </dialog>;
}
