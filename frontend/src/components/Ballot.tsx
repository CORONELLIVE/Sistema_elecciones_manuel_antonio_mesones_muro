import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronRight, CircleCheck, ContactRound, GraduationCap, Info, LoaderCircle, ShieldCheck, Vote} from 'lucide-react';
import {api, ApiError, formatDate, fullName, type Professor, type Student, type Verification} from '../api';
import {NameLookup} from './NameLookup';
import {Confirmation} from './Confirmation';
import {Notice, Shell} from './Shell';

type Election = {eleccion: {id: number; nombre: string}; buscarPorNombre: boolean; profesores: Professor[]; modoPrueba: boolean; soloDni: boolean};

const emptyStudent: Student = {nombres: '', apellidoPaterno: '', apellidoMaterno: ''};

function Progress({step}: {step: number}) {
  return <ol className="progress" aria-label="Progreso de la votación">
    {['Identificación', 'Selección', 'Confirmación'].map((label, index) =>
      <li key={label} className={index <= step ? 'reached' : ''} aria-current={index === step ? 'step' : undefined}>
        <span className="step-number">{index < step ? <Check size={15}/> : index + 1}</span>
        <span>{label}</span>
        {index < 2 && <ChevronRight className="step-arrow" size={16} aria-hidden/>}
      </li>)}
  </ol>;
}

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
  return <Shell>
    <section className="hero">
      <div className="eyebrow"><GraduationCap size={16}/> PARTICIPACIÓN ESTUDIANTIL</div>
      <h1>{election?.eleccion?.nombre ?? 'Elección de Profesores'}</h1>
      <p>Ingresa tu DNI, elige a un profesor y confirma tu voto.</p>
    </section>
    <Progress step={receipt || modal ? 2 : choosing ? 1 : 0}/>
    {election?.modoPrueba && <div className="demo-banner"><Info size={17}/><span><strong>Modo de prueba.</strong> Usa un DNI ficticio del <b>00000001</b> al <b>00000004</b>.</span></div>}
    {electionError && <div className="panel padded">
      <Notice message={electionError}/>
      <button className="button secondary mt-4" onClick={() => {setElectionError(''); setElectionAttempt(electionAttempt + 1);}}>Reintentar</button>
    </div>}
    {!election && !electionError && <p className="panel padded status" role="status"><LoaderCircle size={18} className="spin"/> Cargando la elección…</p>}
    {election && <div className="ballot-layout">
      {receipt ? <section className="panel success" aria-live="polite">
        <div className="success-icon"><CircleCheck size={42}/></div>
        <div className="eyebrow">VOTACIÓN COMPLETADA</div>
        <h2 ref={title} tabIndex={-1}>¡Tu voto fue registrado correctamente!</h2>
        <p>Gracias por participar en la elección.</p>
        <dl className="confirmation-summary">
          {receipt.name && <div><dt>Alumno</dt><dd>{receipt.name}</dd></div>}
          <div><dt>Fecha y hora de Lima</dt><dd>{formatDate(receipt.date)}</dd></div>
        </dl>
        <button className="button secondary" onClick={() => {setReceipt(undefined); focusTitle();}}>Volver al inicio</button>
      </section> : <section className="panel ballot-panel">
        <div className="section-head">
          <span className="feature-icon">{choosing ? <Vote size={24}/> : <ContactRound size={24}/>}</span>
          <div>
            <p className="overline">PASO {choosing ? '02' : '01'} DE 03</p>
            <h2 ref={title} tabIndex={-1}>{choosing ? 'Elige a tu profesor' : 'Ingresa tu DNI'}</h2>
          </div>
        </div>
        {choosing && verification ? <>
          {participant && <div className="verified"><BadgeCheck size={19}/> {participant}</div>}
          <fieldset className="professor-fieldset">
            <legend>Selecciona un candidato.</legend>
            {voteError && <Notice message={voteError}/>}
            {!election.profesores.length && <p className="hint">Aún no hay candidatos disponibles.</p>}
            <div className="professor-grid">
              {election.profesores.map((professor, index) => <label key={professor.id} className="professor-option">
                <input type="radio" name="profesor" checked={selected === professor.id} onChange={() => setSelected(professor.id)}/>
                {professor.fotoUrl ? <img className="candidate-photo" src={professor.fotoUrl} alt=""/>
                  : <span className="professor-avatar" data-tone={index % 4}><GraduationCap size={23}/></span>}
                <span className="professor-name">{professor.nombre}</span>
              </label>)}
            </div>
          </fieldset>
          <div className="ballot-actions">
            <button className="button text-button" onClick={() => {resetIdentity(''); focusTitle();}}><ArrowLeft size={17}/> Cambiar DNI</button>
            <button className="button primary" disabled={!active} onClick={() => {setVoteError(''); setModal(true);}}>
              Continuar y confirmar <ArrowRight size={17}/>
            </button>
          </div>
        </> : <form onSubmit={event => {event.preventDefault(); void continueToBallot();}}>
          <p className="section-description">{election.soloDni ? 'El DNI se usa para permitir un solo voto por número.' : 'Ingresa tu Documento Nacional de Identidad para consultar tus datos.'}</p>
          <label className="field-label" htmlFor="dni">Ingrese su DNI</label>
          <div className="dni-field">
            <input id="dni" disabled={checkingDetails} ref={input} value={dni} inputMode="numeric" autoComplete="off" placeholder="00000000"
              aria-describedby="dni-hint" aria-invalid={Boolean(lookupError && dni.length === 8)}
              onChange={event => {
                const value = event.currentTarget.value.replace(/[^0-9]/g, '').slice(0, 8);
                if (value !== dni) resetIdentity(value);
              }}/>
            <span aria-hidden>{dni.length} / 8</span>
          </div>
          <p className="hint" id="dni-hint">Escribe los 8 dígitos de tu DNI.</p>
          {election.buscarPorNombre && !verification && !manual && <>
            <button type="button" className="button text-button" aria-expanded={showNameLookup}
              onClick={() => setShowNameLookup(value => !value)}>Buscar mi DNI por nombre</button>
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
            {checkingDetails ? 'Comprobando matrícula…' : 'Continuar a la selección'} <ArrowRight size={18}/></button>
        </form>}
      </section>}
      <aside className="guide">
        <span className="guide-icon"><ShieldCheck size={26}/></span>
        <p className="overline">GUÍA DE PARTICIPACIÓN</p>
        <h2>Antes de votar</h2>
        <ul>
          <li><Check size={17}/> Se permite un voto por DNI.</li>
          <li><Check size={17}/> Puedes cambiar de opción antes de confirmar.</li>
          <li><Check size={17}/> Los datos del voto son visibles para la administración autorizada.</li>
        </ul>
      </aside>
    </div>}
    {modal && verification && active && <Confirmation student={participant} professor={active.nombre}
      busy={saving} error={voteError} onClose={() => setModal(false)} onConfirm={submitVote}/>}
  </Shell>;
}
