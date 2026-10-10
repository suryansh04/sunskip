import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import { api } from "./api/client";
import { loginNeeded, signCallsIn } from "./auth";
import Shell from "./pages/Shell";
import HeatPain from "./pages/HeatPain";

if (loginNeeded) signCallsIn(api);

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route element={<Shell />}>
        <Route path="*" element={<HeatPain />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
