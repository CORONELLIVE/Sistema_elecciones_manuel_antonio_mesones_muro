import {useEffect, useState} from 'react';
import {api, type Student} from '../api';

const fields = [['nombres', 'Nombres'], ['apellidoPaterno', 'Apellido paterno'], ['apellidoMaterno', 'Apellido materno']] as const;

export function NameLookup({onFound}: {onFound: (dni: string) => void}) {
  const [names, setNames] = useState<Student>({nombres: '', apellidoPaterno: '', apellidoMaterno: ''});
  const [message, setMessage] = useState('');
  const complete = fields.every(([field]) => names[field].trim());

  useEffect(() => {
    if (!complete) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMessage('Buscando una coincidencia…');
      try {
        const result = await api<{dni: string}>('/alumnos/buscar-nombre', {body: names, signal: controller.signal});
        if (!controller.signal.aborted) onFound(result.dni);
      } catch (error) {
        if (!controller.signal.aborted) setMessage((error as Error).message);
      }
    }, 750);
    return () => {window.clearTimeout(timer); controller.abort();};
  }, [complete, names, onFound]);

  return <fieldset className="student-data">
    <legend>Nombre completo</legend>
    <p className="hint">Puedes escribir con o sin tildes.</p>
    {fields.map(([field, label]) => <label key={field}>{label}
      <input value={names[field]} maxLength={field === 'nombres' ? 120 : 100} onChange={event => {
        setMessage('');
        setNames({...names, [field]: event.currentTarget.value});
      }}/>
    </label>)}
    {message && <p className="hint" role="status">{message}</p>}
  </fieldset>;
}
