import { useEffect, useState } from "react";
import BottomNav from "./BottomNav.jsx";
import Assist from "./Assist.jsx";

export default function StudentShell({ sos, alertActive }) {
  const [tab, setTab] = useState("sos");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);

  return (
    <div className="pr-app">
      <div className="pr-screen" hidden={tab !== "sos"}>
        {sos}
      </div>
      {tab === "assist" && (
        <div className="pr-screen">
          <Assist onGoToSOS={() => setTab("sos")} />
        </div>
      )}
      <BottomNav tab={tab} onTab={setTab} alertActive={alertActive} />
    </div>
  );
}
