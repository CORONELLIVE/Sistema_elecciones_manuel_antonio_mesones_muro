import type {ReactNode} from 'react';
import {ArrowLeft, LockKeyhole, ShieldCheck} from 'lucide-react';
import logo from '../assets/escudo-colegio.png';

export function Shell({children, admin = false}: {children: ReactNode; admin?: boolean}) {
  return <>
    <header className="site-header">
      <div className="frame header-inner">
        <a className="brand" href="/">
          <img className="school-logo" src={logo} alt="Escudo del colegio" width={44} height={57}/>
          <span><strong>Manuel A. Mesones Muro</strong><small>SISTEMA DE VOTACIONES</small></span>
        </a>
        <a className="header-link" href={admin ? '/' : '/admin'}>
          {admin ? <ArrowLeft size={16}/> : <LockKeyhole size={16}/>}
          <span>{admin ? 'Volver a la votación' : 'Administración'}</span>
        </a>
      </div>
    </header>
    <main className="frame main-content">{children}</main>
    <footer className="site-footer">
      <div className="frame footer-inner">
        <span>Sistema de Votaciones · Elección de Profesores</span>
        <span><ShieldCheck size={16}/> Acceso administrativo protegido</span>
      </div>
    </footer>
  </>;
}

export function Notice({message, duplicate = false}: {message: string; duplicate?: boolean}) {
  return <div className="notice" role="alert">
    <strong>{message}</strong>
    {duplicate && <p>Nuestro sistema registra que ya participaste en esta votación. Solo se permite un voto por alumno.</p>}
  </div>;
}
