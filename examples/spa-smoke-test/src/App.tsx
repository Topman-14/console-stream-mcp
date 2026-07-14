import { useEffect } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { Home } from "./routes/Home";
import { About } from "./routes/About";
import { UsersList, UserDetail } from "./routes/Users";
import { Scenarios } from "./routes/Scenarios";
import { DomScratch } from "./DomScratch";

export function App() {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.getElementById("dom-scratch");
      if (!el) return;
      el.textContent = "";
      const p = document.createElement("p");
      p.textContent = `auto-mutated at ${new Date().toLocaleTimeString()}`;
      el.appendChild(p);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="app">
      <h1>mobius-mcp SPA smoke test</h1>
      <p>A React + react-router app for exercising every mobius-mcp capture path: console, errors, network, navigation (route/param/search-param changes), and DOM mutations.</p>

      <nav>
        <NavLink to="/">Home</NavLink>
        <NavLink to="/about">About</NavLink>
        <NavLink to="/users">Users</NavLink>
        <NavLink to="/scenarios">Scenarios</NavLink>
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/users" element={<UsersList />} />
          <Route path="/users/:userId" element={<UserDetail />} />
          <Route path="/scenarios" element={<Scenarios />} />
        </Routes>
      </main>

      <DomScratch />
    </div>
  );
}
