import React from 'react';import{createRoot}from'react-dom/client';import'./style.css';import App from'./App';import PublicTerminalPreview from './PublicTerminalPreview';import HabitatStackPreview from './HabitatStackPreview';
const preview=new URLSearchParams(location.search).get('asset');
createRoot(document.getElementById('root')!).render(<React.StrictMode>{preview==='public-terminal'?<PublicTerminalPreview/>:preview==='habitat-stack'?<HabitatStackPreview/>:<App/>}</React.StrictMode>)
