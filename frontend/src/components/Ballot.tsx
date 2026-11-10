import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, BadgeCheck, CircleCheck, ContactRound, Info, LoaderCircle, Search, UserRound, Vote} from 'lucide-react';
import {api, ApiError, formatDate, fullName, type Professor, type Student, type Verification} from '../api';
import logo from '../assets/escudo-colegio.png';
import {NameLookup} from './NameLookup';
import {Confirmation} from './Confirmation';
import {Notice, Shell} from './Shell';

type Election = {eleccion: {id: number}; participacion: {total: number | null; participaron: number; pendientes: number | null}; buscarPorNombre: boolean; profesores: Professor[]; modoPrueba: boolean; soloDni: boolean};

const emptyStudent: Student = {nombres: '', apellidoPaterno: '', apellidoMaterno: ''};

export function Ballot() {
  const [election, setElection] = useState<Election>();
  const [electionError, setElectionError] = useState('');
  const [electionAttempt, setElectionAttempt] = useState(0);
  const [dni, setDni] = useState('');
  const [showNameLookup, setShowNameLookup] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [verification, setVerification] = useState<Verification>();
  const [lookupError, setLookupError] = useState<ApiError>();
  const [manual, setManual] = useState(false);
  const [details, setDetails] = useState(emptyStudent);
  const [checkingDetails, setCheckingDetails] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [choosing, setChoosing] = useState(false);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [voteError, setVoteError] = useState('');
  const [receipt, setReceipt] = useState<{name?: string; date: string}>();
  const title = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = election?.profesores.find(item => item.id === selected);

  const student = verification?.alumno;
  const participant = student ? fullName(student) : undefined;

  useEffect(() => {
    const controller = new AbortController();
    api<Election>('/eleccion', {signal: controller.signal}).then(setElection, error => {
      if (!controller.signal.aborted) setElectionError(error.message);
    });
    return () => controller.abort();
  }, [electionAttempt]);

  useEffect(() => {
    if (!election || dni.length !== 8 || choosing || receipt || verification || manual || lookupError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<Verification>('/alumnos/consulta', {body: {dni, eleccionId: election.eleccion.id}, signal: controller.signal}).then(result => {
        if (!controller.signal.aborted) setVerification(result);
      }, error => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.code === 'ELECCION_CAMBIO') {
          setElection(undefined);
          setElectionAttempt(value => value + 1);
        } else if (error instanceof ApiError && error.code === 'COMPLETAR_DATOS') setManual(true);
        else setLookupError(error);
      });
    }, 400);
    return () => {window.clearTimeout(timer); controller.abort();};
  }, [dni, attempt, election, choosing, receipt, verification, manual, lookupError]);

  const resetIdentity = useCallback((nextDni: string) => {
    setDni(nextDni);
    setVerification(undefined);
    setManual(false);
    setDetails(emptyStudent);
    setLookupError(undefined);
    setChoosing(false);
    setSelected(undefined);
    setShowNameLookup(false);
  }, []);

  function focusTitle() {
    window.requestAnimationFrame(() => title.current?.focus());
  }

  async function continueToBallot() {
    if (verification) {
      setChoosing(true);
      focusTitle();
      return;
    }
    if (!election || !manual || checkingDetails) return;
    setCheckingDetails(true);
    setLookupError(undefined);
    try {
      const verified = await api<Verification>('/alumnos/consulta', {body: {dni, datos: details, eleccionId: election.eleccion.id}});
      setVerification(verified);
      setChoosing(true);
      focusTitle();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'ELECCION_CAMBIO') {
          resetIdentity(dni);
          setElection(undefined);
          setElectionAttempt(value => value + 1);
          return;
        }
        if (error.code === 'YA_VOTO') setManual(false);
        setLookupError(error);
      }
    } finally {
      setCheckingDetails(false);
    }
  }

  async function submitVote() {
    if (!verification || !active || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setVoteError('');
    try {
      const result = await api<{fechaVoto: string}>('/votos', {
        body: {ticket: verification.ticket, profesorId: active.id},
      });
      setReceipt({name: participant, date: result.fechaVoto});
      setElectionAttempt(value => value + 1);
      setModal(false);
      resetIdentity('');
      focusTitle();
    } catch (error) {
      if (error instanceof ApiError && ['YA_VOTO', 'VERIFICACION_VENCIDA', 'ELECCION_CAMBIO'].includes(error.code)) {
        setModal(false);
        resetIdentity('');
        setLookupError(error);
        if (error.code === 'ELECCION_CAMBIO') setElectionAttempt(value => value + 1);
        focusTitle();
      } else if (error instanceof ApiError && error.code === 'PROFESOR_INVALIDO') {
        setModal(false);
        setSelected(undefined);
        setElectionAttempt(value => value + 1);
        setVoteError('La lista de candidatos cambió. Selecciona una opción disponible.');
      } else setVoteError((error as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const waiting = Boolean(election && dni.length === 8 && !verification && !lookupError && !manual);
  return <Shell ballot>
    <div className="election-front">
      <section className="election-cover" aria-labelledby="election-heading">
        <div className="election-cover-copy">
          <div className="election-cover-brand">
            <img src={logo} alt="" width={48} height={60}/>
            <p className="election-school">Manuel Antonio Mesones Muro</p>
          </div>
          <h1 id="election-heading">Elecciones del Municipio Escolar 2026</h1>
          <p className="election-intro">Ingresa tu DNI y elige a tu candidato.</p>
          <dl className="election-stats">
            <div><dt>Total de votantes</dt><dd>{election?.participacion.total?.toLocaleString('es-PE') ?? '—'}</dd></div>
            <div><dt>Participaron</dt><dd>{election?.participacion.participaron.toLocaleString('es-PE') ?? '—'}</dd></div>
            <div><dt>Pendientes</dt><dd>{election?.participacion.pendientes?.toLocaleString('es-PE') ?? '—'}</dd></div>
          </dl>
        </div>
      </section>
      <div className="election-form">
        {election?.modoPrueba && <div className="demo-banner"><Info size={17}/><span><strong>Modo de prueba.</strong> Usa un DNI ficticio del <b>00000001</b> al <b>00000004</b>.</span></div>}
        {electionError && <div className="panel padded">
          <Notice message={electionError}/>
          <button className="button secondary mt-4" onClick={() => {setElectionError(''); setElectionAttempt(electionAttempt + 1);}}>Reintentar</button>
        </div>}
        {!election && !electionError && <p className="panel padded status" role="status"><LoaderCircle size={18} className="spin"/> Cargando la elección…</p>}
        {election && <div className="ballot-layout">
          {receipt ? <section className="panel success" aria-live="polite">
            <div className="success-icon"><CircleCheck size={42}/></div>
            <h2 ref={title} tabIndex={-1}>¡Voto registrado!</h2>
            <dl className="confirmation-summary">
              {receipt.name && <div><dt>Alumno</dt><dd>{receipt.name}</dd></div>}
              <div><dt>Fecha y hora de Lima</dt><dd>{formatDate(receipt.date)}</dd></div>
            </dl>
            <button className="button secondary" onClick={() => {setReceipt(undefined); focusTitle();}}>Volver al inicio</button>
          </section> : <section className={choosing ? "panel ballot-panel ballot-choices" : "panel ballot-panel ballot-entry"}>
            <div className="section-head">
              <span className="feature-icon">{choosing ? <Vote size={24}/> : <ContactRound size={24}/>}</span>
              <div>
                <h2 ref={title} tabIndex={-1}>{choosing ? 'Elige tu candidato' : 'Ingresa tu DNI'}</h2>
              </div>
            </div>
            {choosing && verification ? <>
              {participant && <div className="verified"><BadgeCheck size={19}/> {participant}</div>}
              <fieldset className="professor-fieldset">
                <legend className="sr-only">Candidatos</legend>
                {voteError && <Notice message={voteError}/>}
                {!election.profesores.length && <p className="hint">Aún no hay candidatos disponibles.</p>}
                <div className="professor-grid">
                  {election.profesores.map((professor, index) => <label key={professor.id} className="professor-option">
                    <input type="radio" name="profesor" checked={selected === professor.id} onChange={() => setSelected(professor.id)}/>
                    <span className="ballot-candidate-image" data-tone={index % 4}>
                      {professor.fotoUrl ? <img src={professor.fotoUrl} alt=""/> : <UserRound size={52} aria-hidden="true"/>}
                    </span>
                    <span className="professor-name">{professor.nombre}</span>
                  </label>)}
                </div>
              </fieldset>
              <div className="ballot-actions">
                <button className="button secondary" onClick={() => {resetIdentity(''); focusTitle();}}><ArrowLeft size={17}/> Cambiar DNI</button>
                <button className="button primary" disabled={!active} onClick={() => {setVoteError(''); setModal(true);}}>
                  <Vote size={21}/> Revisar mi voto
                </button>
              </div>
            </> : <form onSubmit={event => {event.preventDefault(); void continueToBallot();}}>
              <label className="sr-only" htmlFor="dni">Ingresa tu DNI</label>
              <input className="ballot-dni" id="dni" disabled={checkingDetails} ref={input} value={dni} inputMode="numeric" autoComplete="off" placeholder="00000000"
                  aria-describedby="dni-hint" aria-invalid={Boolean(lookupError && dni.length === 8)}
                  onChange={event => {
                    const value = event.currentTarget.value.replace(/[^0-9]/g, '').slice(0, 8);
                    if (value !== dni) resetIdentity(value);
                  }}/>
              <p className="hint" id="dni-hint">8 dígitos</p>
              {election.buscarPorNombre && !verification && !manual && <>
                <button type="button" className="button secondary lookup-button" aria-expanded={showNameLookup}
                  onClick={() => setShowNameLookup(value => !value)}><Search size={21}/> Buscar por nombre</button>
                {showNameLookup && <NameLookup onFound={resetIdentity}/>}
              </>}
              {waiting && <p className="status" role="status"><LoaderCircle className="spin" size={17}/> {election.soloDni ? 'Comprobando si el DNI ya votó…' : 'Consultando DNI...'}</p>}
              {lookupError && <div className="mt-4">
                <Notice message={lookupError.message} duplicate={lookupError.code === 'YA_VOTO'}/>
                {lookupError.code === 'YA_VOTO' ? <button className="button text-button" type="button" onClick={() => {resetIdentity(''); input.current?.focus();}}>Ingresar otro DNI</button>
                  : !manual && dni.length === 8 && <button className="button text-button" type="button" onClick={() => {setLookupError(undefined); setAttempt(attempt + 1);}}>Reintentar consulta</button>}
              </div>}
              {manual && !student && <div className="student-data">
                <p className="section-description">Tu DNI no figura en el padrón. Escribe tus nombres y apellidos tal como aparecen en tu matrícula.</p>
                <label>Nombres<input required maxLength={120} disabled={checkingDetails} value={details.nombres}
                  onChange={event => setDetails({...details, nombres: event.target.value})}/></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>Apellido paterno<input required maxLength={100} disabled={checkingDetails} value={details.apellidoPaterno}
                    onChange={event => setDetails({...details, apellidoPaterno: event.target.value})}/></label>
                  <label>Apellido materno<input maxLength={100} disabled={checkingDetails} value={details.apellidoMaterno}
                    onChange={event => setDetails({...details, apellidoMaterno: event.target.value})}/></label>
                </div>
              </div>}
              {student && <div className="student-data">
                <div className="verified" role="status"><BadgeCheck size={19}/> Datos verificados</div>
                <label>Nombres<input readOnly value={student.nombres}/></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>Apellido paterno<input readOnly value={student.apellidoPaterno}/></label>
                  <label>Apellido materno<input readOnly value={student.apellidoMaterno}/></label>
                </div>
              </div>}
              <button className="button primary continue" type="submit" disabled={checkingDetails || (!verification && (!manual || !details.nombres.trim() || !details.apellidoPaterno.trim()))}>
                {checkingDetails ? 'Comprobando matrícula…' : 'Ingresar'} <ArrowRight size={18}/></button>
            </form>}
          </section>}
        </div>}
      </div>
    </div>
    {modal && verification && active && <Confirmation student={participant} professor={active.nombre}
      busy={saving} error={voteError} onClose={() => setModal(false)} onConfirm={submitVote}/>}
  </Shell>;
}
