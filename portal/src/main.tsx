import { lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import "./index.css";
import { api } from "./api/client";
import { isLoggedIn, loginNeeded, signCallsIn } from "./auth";
import Login from "./pages/Login";
import Callback from "./pages/Callback";
import Shell from "./pages/Shell";
// Each signed-in page loads when first opened, so the sign-in page doesn't download them all
const HeatPain = lazy(() => import("./pages/HeatPain"));
const Stretch = lazy(() => import("./pages/Stretch"));
const Recommendations = lazy(() => import("./pages/Recommendations"));
const Simulate = lazy(() => import("./pages/Simulate"));
const Stats = lazy(() => import("./pages/Stats"));

if (loginNeeded) signCallsIn(api);

// Every page but sign-in needs a session; the page asked for is opened after signing in
function SignedIn() {
  const location = useLocation();
  if (loginNeeded && !isLoggedIn()) return <Navigate to="/login" replace state={{ next: location.pathname + location.search }} />;
  return <Shell />;
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/callback" element={<Callback />} />
      <Route element={<SignedIn />}>
        <Route path="/stretch/:stretchId" element={<Stretch />} />
        <Route path="/recommendations" element={<Recommendations />} />
        <Route path="/simulate" element={<Simulate />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="*" element={<HeatPain />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
