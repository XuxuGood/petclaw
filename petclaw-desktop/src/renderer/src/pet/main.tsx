import React from 'react'
import ReactDOM from 'react-dom/client'
import { PetApp } from './PetApp'
import './pet.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PetApp />
  </React.StrictMode>
)
