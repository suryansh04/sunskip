import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import Home from "./pages/Home";

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <div className="fixed inset-0 mx-auto max-w-[430px] overflow-hidden bg-paper min-[600px]:inset-y-6 min-[600px]:rounded-[28px] min-[600px]:shadow-[0_20px_60px_rgba(40,25,10,.25)]">
      <Routes>
        <Route path="*" element={<Home />} />
      </Routes>
    </div>
  </BrowserRouter>,
);
