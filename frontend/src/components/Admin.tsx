import {useEffect, useState, type FormEvent} from 'react';
import {ArrowDown, ChevronLeft, ChevronRight, Clock3, Info, LoaderCircle, LockKeyhole, LogOut, Search, Trophy, UsersRound, Vote} from 'lucide-react';
import {api, ApiError, formatDate, type Professor} from '../api';
import {ElectionPanel, type ElectionSummary, type ArchivedElection} from './ElectionPanel';
import {CandidatePanel} from './CandidatePanel';
import {Notice, Shell} from './Shell';

type Result = Professor & {votos: number; porcentaje: number; retirado: boolean};
type Dashboard = {
  eleccion: ElectionSummary;
  historial: ArchivedElection[];
  total: number; participantes: number; lideres: string[]; ultimoVoto: string | null;
  candidatos: Professor[];
  resultados: Result[]; registros: {numero: number; alumno: string; profesorId: number; fechaVoto: string}[];
  pagina: number; paginas: number; coincidencias: number;
};
const percent = new Intl.NumberFormat('es-PE', {maximumFractionDigits: 1});
const percentage = (value: number) => percent.format(value) + '%';

export function Admin() {
  const [session, setSession] = useState<'checking' | 'login' | 'active'>('checking');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<Dashboard>();
  const [query, setQuery] = useState('');
  const [professor, setProfessor] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (session === 'login') return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function refresh() {
      const filters = new URLSearchParams({buscar: query, pagina: String(page)});
      if (professor) filters.set('profesor', professor);
      try {
        const next = await api<Dashboard>('/admin/resultados?' + filters, {signal: controller.signal});
        if (controller.signal.aborted) return;
        setData(next);
        setSession('active');
        setError('');
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 401) {
          setError(session === 'active' ? 'Tu sesión expiró. Vuelve a iniciar sesión.' : '');
          setData(undefined);
          setSession('login');
          return;
        }
        setError((failure as Error).message);
      }
      if (!controller.signal.aborted) timer = window.setTimeout(refresh, 5000);
    }
    timer = window.setTimeout(refresh, query ? 250 : 0);
    return () => {window.clearTimeout(timer); controller.abort();};
  }, [session, query, professor, page, attempt]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/admin/login', {body: {password}});
      setPassword('');
      setSession('active');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/admin/logout', {body: {}});
      setSession('login');
      setData(undefined);
      setQuery('');
      setProfessor('');
      setPage(1);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        setSession('login');
        setData(undefined);
      } else setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (session === 'login') return <Shell admin>
    <section className="panel admin-login">
      <span className="feature-icon"><LockKeyhole size={24}/></span>
      <p className="overline">ACCESO RESTRINGIDO</p>
      <h1>Panel administrativo</h1>
      <p>Ingresa tu contraseña para consultar los resultados.</p>
      <form onSubmit={login}>
        <label className="field-label" htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" maxLength={256} required
          value={password} onChange={event => setPassword(event.target.value)}/>
        {error && <Notice message={error}/>}
        <button className="button primary continue" disabled={busy || !password}>
          {busy ? <LoaderCircle className="spin" size={18}/> : <LockKeyhole size={17}/>} Iniciar sesión
        </button>
      </form>
    </section>
  </Shell>;

  const detail = data?.resultados.find(item => String(item.id) === professor);
  const names = new Map(data?.resultados.map(item => [item.id, item.nombre]));
  const selectProfessor = (value: string) => {setProfessor(value); setPage(1);};

  return <Shell admin>
    <div className="admin-head">
      <div>
        <p className="eyebrow"><Vote size={16}/> MUNICIPIO ESCOLAR 2026</p>
        <h1>Resultados de la votación</h1>
        <p>Consulta la participación y el detalle de los votos registrados.</p>
      </div>
      {session === 'active' && <button className="button secondary" disabled={busy} onClick={logout}><LogOut size={17}/> Cerrar sesión</button>}
    </div>
    {error && <div className="mb-4">
      <Notice message={error}/>
      <button className="button text-button" onClick={() => setAttempt(attempt + 1)}>Actualizar resultados</button>
    </div>}
    {!data && !error && <p className="status" role="status"><LoaderCircle className="spin" size={18}/> Cargando resultados…</p>}
    {data && <>
      <div className="privacy"><Info size={19}/><p><strong>Privacidad.</strong> Este sistema registra votos identificables y no constituye una votación secreta.</p></div>
      <ElectionPanel current={data.eleccion} history={data.historial} total={data.total} onChange={() => {
        setProfessor('');
        setPage(1);
        setAttempt(value => value + 1);
      }}/>
      <CandidatePanel candidates={data.candidatos} onChange={() => {
        setProfessor('');
        setPage(1);
        setAttempt(value => value + 1);
      }}/>
      <div className="metric-grid">
        {[
          {label: 'Votos registrados', value: data.total, Icon: Vote},
          {label: 'Alumnos participantes', value: data.participantes, Icon: UsersRound},
          {label: data.lideres.length > 1 ? 'Empate en primer lugar' : 'Candidato con más votos', value: data.lideres.join(', ') || 'Sin votos', Icon: Trophy},
          {label: 'Última votación · Lima', value: data.ultimoVoto ? formatDate(data.ultimoVoto) : 'Sin registros', Icon: Clock3},
        ].map(({label, value, Icon}) => <div className="panel metric" key={label}>
          <Icon size={20}/><span>{label}</span><strong>{value}</strong>
        </div>)}
      </div>
      <section className="panel results-panel">
        <div className="results-head">
          <div><p className="overline">DISTRIBUCIÓN DE VOTOS</p><h2>Resultados por candidato</h2></div>
          <span className="live"><span/> Actualización cada 5 s</span>
        </div>
        <div className="results-grid">
          {data.resultados.map((item, index) => <button key={item.id} className="result-card"
            aria-pressed={String(item.id) === professor} onClick={() => selectProfessor(professor === String(item.id) ? '' : String(item.id))}>
            <span className="result-name">{item.fotoUrl && <img className="result-photo" src={item.fotoUrl} alt=""/>}<span>{item.nombre}{item.retirado && ' (retirado)'}</span><ArrowDown size={15}/></span>
            <span className="result-count">{item.votos} <small>{item.votos === 1 ? 'voto' : 'votos'}</small></span>
            <span className="result-chart"><progress data-tone={index % 4} max={100} value={item.porcentaje} aria-label={'Porcentaje de ' + item.nombre}/><span>{percentage(item.porcentaje)}</span></span>
          </button>)}
        </div>
      </section>
      <section className="panel table-panel" aria-labelledby="registry-title">
        <div className="results-head">
          <div>
            <p className="overline">REGISTRO DE PARTICIPACIÓN</p>
            <h2 id="registry-title">{detail ? 'Detalle de ' + detail.nombre : 'Alumnos que votaron'}</h2>
            {detail && <p>{detail.votos} {detail.votos === 1 ? 'voto' : 'votos'} · {percentage(detail.porcentaje)} del total</p>}
          </div>
        </div>
        <div className="filters">
          <label><span className="field-label">Buscar alumno</span><span className="search-field"><Search size={18}/>
            <input type="search" placeholder="Nombres o apellidos" value={query} maxLength={150}
              onChange={event => {setQuery(event.target.value); setPage(1);}}/>
          </span></label>
          <label><span className="field-label">Filtrar por candidato</span>
            <select value={professor} onChange={event => selectProfessor(event.target.value)}>
              <option value="">Todos los candidatos</option>
              {data.resultados.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
            </select>
          </label>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabla de votos">
          <table>
            <thead><tr><th scope="col">N.º</th><th scope="col">Alumno</th><th scope="col">Candidato seleccionado</th><th scope="col">Fecha y hora · Lima</th></tr></thead>
            <tbody>
              {data.registros.map(row => <tr key={row.numero}>
                <td>{row.numero}</td><td>{row.alumno || 'Sin nombre registrado'}</td><td>{names.get(row.profesorId)}</td><td>{formatDate(row.fechaVoto)}</td>
              </tr>)}
              {!data.registros.length && <tr><td colSpan={4} className="empty">No hay registros para mostrar.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>{data.coincidencias} {data.coincidencias === 1 ? 'registro' : 'registros'} · Página {data.pagina} de {data.paginas}</span>
          <div>
            <button className="button secondary" aria-label="Página anterior" disabled={data.pagina <= 1} onClick={() => setPage(data.pagina - 1)}><ChevronLeft size={18}/></button>
            <button className="button secondary" aria-label="Página siguiente" disabled={data.pagina >= data.paginas} onClick={() => setPage(data.pagina + 1)}><ChevronRight size={18}/></button>
          </div>
        </div>
      </section>
    </>}
  </Shell>;
}
