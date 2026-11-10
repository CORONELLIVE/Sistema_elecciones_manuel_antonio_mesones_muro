import {useState, type FormEvent} from 'react';
import {Download, Plus, RotateCcw} from 'lucide-react';
import {api, formatDate} from '../api';
import {Notice} from './Shell';

export type ElectionSummary = {id: number; nombre: string};
export type ArchivedElection = ElectionSummary & {cierre: string; total: number};

function PdfLink({id}: {id: number}) {
  return <a className="button secondary" href={'/api/admin/elecciones/' + id + '/resultados.pdf'} download>
    <Download size={16}/> Descargar PDF
  </a>;
}

export function ElectionPanel({current, history, total, onChange}: {
  current: ElectionSummary; history: ArchivedElection[]; total: number; onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function start(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim() || !window.confirm('¿Cerrar la votación actual e iniciar otra? Se conservarán sus resultados.')) return;
    setBusy(true);
    setError('');
    try {
      await api('/admin/elecciones/iniciar', {body: {actual: current.id, nombre: name}});
      setName('');
      setOpen(false);
      setStatus('Nueva votación iniciada. Cada estudiante puede participar una vez.');
      onChange();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset(election: ElectionSummary, archivada: boolean) {
    if (busy || !window.confirm('¿Restablecer «' + election.nombre + '»? Al aceptar, se borrarán todos los votos y registros de participación de esta votación. Los resultados volverán a cero, como si nadie hubiera votado.')) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api('/admin/elecciones/restablecer', {body: {id: election.id, archivada}});
      setStatus('Votación restablecida. Los resultados volvieron a cero.');
      onChange();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel padded candidate-panel" aria-labelledby="elections-title">
    <div className="results-head">
      <div>
        <p className="overline">VOTACIÓN ACTIVA</p>
        <h2 id="elections-title">{current.nombre}</h2>
        <p>{total} {total === 1 ? 'voto registrado' : 'votos registrados'}</p>
      </div>
      <div className="election-actions">
        <PdfLink id={current.id}/>
        <button className="button secondary" disabled={busy} onClick={() => void reset(current, false)}><RotateCcw size={16}/> Restablecer votos</button>
        <button className="button primary" onClick={() => setOpen(value => !value)} aria-expanded={open}><Plus size={16}/> Nueva votación</button>
      </div>
    </div>
    {error && <Notice message={error}/>}
    {status && <p className="status" role="status">{status}</p>}
    {open && <form className="candidate-editor" onSubmit={start}>
      <label className="field-label">Nombre de la nueva votación
        <input required maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)}/>
      </label>
      <p className="hint">La votación actual se archivará. La nueva empieza en cero con los candidatos actuales.</p>
      <button className="button primary mt-4" disabled={busy || !name.trim()}>Iniciar votación</button>
    </form>}
    {!!history.length && <details className="election-history">
      <summary>Votaciones anteriores ({history.length})</summary>
      <ul className="candidate-list">
        {history.map(election => <li key={election.id}>
          <div><strong>{election.nombre}</strong><p className="hint">{election.total} votos · {formatDate(election.cierre)}</p></div>
          <div className="election-actions">
            <PdfLink id={election.id}/>
            <button className="button secondary" disabled={busy} onClick={() => void reset(election, true)}><RotateCcw size={16}/> Restablecer votos</button>
          </div>
        </li>)}
      </ul>
    </details>}
  </section>;
}
