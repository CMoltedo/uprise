import React from "react";
import ReactDOM from "react-dom/client";
import { LocationApp } from "./ui/LocationApp.js";
import "./ui/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocationApp />
  </React.StrictMode>,
);
