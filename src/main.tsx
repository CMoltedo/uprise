import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect, useState } from "react";
import { App } from "./ui/App.js";
import { AdminApp } from "./ui/AdminApp.js";
import "./ui/styles.css";

const getRoute = () =>
  window.location.hash.toLowerCase() === "#/admin" ? "admin" : "game";

const Root = () => {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const handler = () => setRoute(getRoute());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return route === "admin" ? <AdminApp /> : <App />;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
