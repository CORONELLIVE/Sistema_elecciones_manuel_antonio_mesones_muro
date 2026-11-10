import {useEffect, useState, type FormEvent} from 'react';
import {ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, UsersRound} from 'lucide-react';
import {api, fullName, type Student} from '../api';
import {Notice} from './Shell';

type Row = {id: string; names: Student; dni: string | null; tieneDni: boolean; tipoDocumento: string;
  matricula: 'DEFINITIVA' | 'TRASLADADO'; grado: number | null; seccion: string};
type Page = {total: number; page: number; pages: number; students: Row[]};
const empty: Row = {id: '', names: {nombres: '', apellidoPaterno: '', apellidoMaterno: ''}, dni: null,
  tieneDni: false, tipoDocumento: '', matricula: 'DEFINITIVA', grado: null, seccion: ''};
const fields = [['nombres', 'Nombres'], ['apellidoPaterno', 'Apellido paterno'], ['apellidoMaterno', 'Apellido materno']] as const;

export function RosterPanel() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Page>();
  const [draft, setDraft] = useState<Row>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      api<Page>('/admin/padron/buscar', {body: {query, page}, signal: controller.signal}).then(result => {
        if (!controller.signal.aborted) setData(result);
      }, failure => {
        if (!controller.signal.aborted) setError((failure as Error).message);
      });
    }, 250);
    return () => {window.clearTimeout(timeout); controller.abort();};
  }, [open, query, page, version]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api('/admin/padron/guardar', {body: {id: draft.id || undefined, dni: draft.dni || undefined,
        names: draft.names, matricula: draft.matricula, grado: draft.grado, seccion: draft.seccion}});
      setDraft(undefined);
      if (!draft.id) {setQuery(''); setPage(1);}
      setVersion(value => value + 1);
      setStatus('Registro guardado.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(student: Row) {
    if (busy || !window.confirm('¿Eliminar a ' + fullName(student.names) + ' del padrón?')) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api('/admin/padron/eliminar', {body: {id: student.id}});
      if (draft?.id === student.id) setDraft(undefined);
      setVersion(value => value + 1);
      setStatus('Registro eliminado.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel padded candidate-panel" aria-labelledby="roster-title">
    <div className="results-head">
      <h2 id="roster-title">Padrón de estudiantes</h2>
      <button className="button secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <UsersRound size={17}/> {open ? 'Cerrar padrón' : 'Gestionar padrón'}
      </button>
    </div>
    {open && <>
      <div className="filters">
        <label><span className="field-label">Buscar por nombre o DNI</span><span className="search-field">
          <Search size={17}/><input maxLength={250} value={query} onChange={event => {setQuery(event.target.value); setPage(1); setError('');}}/>
        </span></label>
        <button className="button primary" disabled={busy} onClick={() => {setDraft(empty); setError('');}}>
          <Plus size={17}/> Agregar estudiante
        </button>
      </div>
      {error && <Notice message={error}/>}
      {status && <p className="status" role="status">{status}</p>}
      {draft && <form className="candidate-editor" onSubmit={save}>
        <h3>{draft.id ? 'Editar estudiante' : 'Nuevo estudiante'}</h3>
        <fieldset disabled={busy}>
          {fields.map(([key, label]) => <label className="field-label" key={key}>{label}
            <input required={key !== 'apellidoMaterno'} maxLength={key === 'nombres' ? 120 : 100} value={draft.names[key]}
              onChange={event => setDraft({...draft, names: {...draft.names, [key]: event.target.value}})}/>
          </label>)}
          <label className="field-label">DNI
            <input inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={draft.dni ?? ''}
              placeholder={draft.tieneDni && !draft.dni ? 'DNI registrado' : ''}
              onChange={event => setDraft({...draft, dni: event.target.value.replace(/[^0-9]/g, '')})}/>
          </label>
          <div className="filters">
            <label className="field-label">Grado<select value={draft.grado ?? ''} onChange={event => setDraft({...draft, grado: Number(event.target.value) || null})}>
              <option value="">Sin grado</option>{[1, 2, 3, 4, 5].map(value => <option key={value}>{value}</option>)}
            </select></label>
            <label className="field-label">Sección<input maxLength={12} value={draft.seccion} onChange={event => setDraft({...draft, seccion: event.target.value})}/></label>
          </div>
          <label className="field-label">Matrícula<select value={draft.matricula} onChange={event => setDraft({...draft, matricula: event.target.value === 'TRASLADADO' ? 'TRASLADADO' : 'DEFINITIVA'})}>
            <option value="DEFINITIVA">Definitiva</option><option value="TRASLADADO">Trasladado</option>
          </select></label>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={() => setDraft(undefined)}>Cancelar</button>
            <button className="button primary">Guardar registro</button>
          </div>
        </fieldset>
      </form>}
      {data && <>
        <div className="table-scroll" tabIndex={0} aria-label="Padrón de estudiantes">
          <table>
            <thead><tr><th scope="col">Estudiante</th><th scope="col">Documento</th><th scope="col">Grado y sección</th><th scope="col">Matrícula</th><th scope="col">Acciones</th></tr></thead>
            <tbody>{data.students.map(student => <tr key={student.id}>
              <td>{fullName(student.names)}</td><td>{student.dni ?? (student.tieneDni ? 'DNI registrado' : student.tipoDocumento || 'Sin documento')}</td>
              <td>{[student.grado, student.seccion].filter(Boolean).join(' ') || '—'}</td><td>{student.matricula === 'DEFINITIVA' ? 'Definitiva' : 'Trasladado'}</td>
              <td><div className="election-actions">
                <button className="button secondary" aria-label={'Editar a ' + fullName(student.names)} disabled={busy} onClick={() => {setDraft(student); setError('');}}><Pencil size={16}/></button>
                <button className="button secondary" aria-label={'Eliminar a ' + fullName(student.names)} disabled={busy} onClick={() => void remove(student)}><Trash2 size={16}/></button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!data.students.length && <p className="hint">No hay registros para esta búsqueda.</p>}
        <div className="pagination">
          <span>{data.total} registros · Página {data.page} de {data.pages}</span>
          <div>
            <button className="button secondary" aria-label="Página anterior del padrón" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}><ChevronLeft size={17}/></button>
            <button className="button secondary" aria-label="Página siguiente del padrón" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}><ChevronRight size={17}/></button>
          </div>
        </div>
      </>}
    </>}
  </section>;
}
