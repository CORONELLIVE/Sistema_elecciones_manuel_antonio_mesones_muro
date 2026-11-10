import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Admin} from './components/Admin';
import {Ballot} from './components/Ballot';
import './styles.css';

const admin = /^\/admin\/?$/.test(window.location.pathname);
createRoot(document.getElementById('root')!).render(
  <StrictMode>{admin ? <Admin/> : <Ballot/>}</StrictMode>,
);
