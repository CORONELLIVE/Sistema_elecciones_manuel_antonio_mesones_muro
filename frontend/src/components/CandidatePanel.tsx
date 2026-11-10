import {useState, type FormEvent} from 'react';
import {GraduationCap, Pencil, Plus, Trash2} from 'lucide-react';
import {api, type Professor} from '../api';
import {Notice} from './Shell';

const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function encodePhoto(file: File) {
  return new Promise<{type: string; data: string}>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => resolve({type: file.type, data: String(reader.result).split(',')[1]});
    reader.readAsDataURL(file);
  });
}

export function CandidatePanel({candidates, onChange}: {candidates: Professor[]; onChange: () => void}) {
  const [editor, setEditor] = useState<Professor | 'new'>();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  function edit(candidate: Professor | 'new') {
    setName(candidate === 'new' ? '' : candidate.nombre);
    setPhoto(undefined);
    setError('');
    setStatus('');
    setEditor(candidate);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (photo && (!imageTypes.includes(photo.type) || photo.size > 2 * 1024 * 1024)) {
        throw new Error('Selecciona una foto PNG, JPG, WebP o GIF de hasta 2 MB.');
      }
      await api('/admin/candidatos/guardar', {body: {
        id: editor === 'new' ? undefined : editor.id, nombre: name, photo: photo && await encodePhoto(photo),
      }});
      setEditor(undefined);
      setPhoto(undefined);
      setStatus(editor === 'new' ? 'Candidato agregado.' : 'Candidato actualizado.');
      onChange();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(candidate: Professor) {
    if (busy || !window.confirm('¿Quitar a ' + candidate.nombre + ' de la papeleta?')) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api('/admin/candidatos/retirar', {body: {id: candidate.id}});
      if (editor && editor !== 'new' && editor.id === candidate.id) setEditor(undefined);
      setStatus('Candidato retirado de la papeleta.');
      onChange();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel padded candidate-panel" aria-labelledby="candidates-title">
    <div className="results-head">
      <div>
        <p className="overline">PAPELETA ELECTORAL</p>
        <h2 id="candidates-title">Candidatos</h2>
        <p>Administra el nombre y la foto que verá el alumnado al votar.</p>
      </div>
      <button className="button primary" disabled={busy} onClick={() => edit('new')}><Plus size={17}/> Agregar candidato</button>
    </div>
    {error && <Notice message={error}/>}
    {status && <p className="status" role="status">{status}</p>}
    {editor && <form className="candidate-editor" onSubmit={save} key={editor === 'new' ? 'new' : editor.id}>
      <label className="field-label">Nombre del candidato
        <input value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy}/>
      </label>
      <label className="field-label">Foto del candidato
        <input type="file" accept={imageTypes.join(',')} onChange={event => setPhoto(event.target.files?.[0])} disabled={busy}/>
      </label>
      <p className="hint">PNG, JPG, WebP o GIF. Hasta 2 MB.</p>
      <div className="dialog-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={() => {setEditor(undefined); setError('');}}>Cancelar</button>
        <button className="button primary" disabled={busy || !name.trim()}>Guardar candidato</button>
      </div>
    </form>}
    {!candidates.length && <p className="hint">Aún no hay candidatos en la papeleta.</p>}
    <ul className="candidate-list">
      {candidates.map(candidate => <li key={candidate.id}>
        {candidate.fotoUrl ? <img className="candidate-photo" src={candidate.fotoUrl} alt=""/>
          : <span className="professor-avatar" data-tone="0"><GraduationCap size={20}/></span>}
        <strong>{candidate.nombre}</strong>
        <button className="button secondary" aria-label={'Editar ' + candidate.nombre} disabled={busy} onClick={() => edit(candidate)}><Pencil size={16}/></button>
        <button className="button secondary" aria-label={'Quitar ' + candidate.nombre} disabled={busy} onClick={() => void remove(candidate)}><Trash2 size={16}/></button>
      </li>)}
    </ul>
  </section>;
}
