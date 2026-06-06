import { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users
} from "lucide-react";
import { api, clearAdminToken, saveAdminToken } from "./api";
import logoUrl from "../assets/zyz-logo.png";
import "../styles/main.css";

type View = "dashboard" | "users" | "orders" | "resources";

interface Dashboard {
  users: number;
  activeRentals: number;
  onlineResources: number;
  pendingWithdrawals: number;
  usageCount: number;
  gmv: string;
  supplierIncome: string;
}

interface Row {
  id: string;
  email?: string;
  status?: string;
  resourceType?: string;
  totalAmount?: string;
  createdAt?: string;
}

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem("zyz_admin_token")));

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await api<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    saveAdminToken(data.token);
    setLoggedIn(true);
    setMessage("登录成功");
    await refresh("dashboard");
  }

  async function refresh(nextView = view) {
    try {
      setView(nextView);
      if (nextView === "dashboard") {
        setDashboard(await api<Dashboard>("/api/admin/dashboard"));
        setRows([]);
      }
      if (nextView === "users") setRows(await api<Row[]>("/api/admin/users"));
      if (nextView === "orders") setRows(await api<Row[]>("/api/admin/orders"));
      if (nextView === "resources") setRows(await api<Row[]>("/api/admin/resources"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    if (loggedIn) refresh("dashboard");
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <main className="login-page">
        <section className="login-shell glass-panel">
          <div className="login-copy">
            <div className="brand-lockup">
              <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" />
              <div>
                <strong>智算驿站</strong>
                <span>运营中枢</span>
              </div>
            </div>
            <h1>供需调度与结算控制台</h1>
            <p>面向运营、审核、资源调度与财务结算的深色工作台。</p>
          </div>
          <form onSubmit={login}>
            <span className="eyebrow">Admin Access</span>
            <h2>登录后台</h2>
            {message && <div className="notice compact">{message}</div>}
            <input name="email" type="email" placeholder="邮箱" required />
            <input name="password" type="password" placeholder="密码" required />
            <button>进入控制台</button>
          </form>
        </section>
      </main>
    );
  }

  const cards = [
    { label: "用户数", value: dashboard?.users ?? 0, icon: <Users size={20} /> },
    { label: "有效租赁", value: dashboard?.activeRentals ?? 0, icon: <KeyRound size={20} /> },
    { label: "在线资源", value: dashboard?.onlineResources ?? 0, icon: <Boxes size={20} /> },
    { label: "GMV", value: `$${dashboard?.gmv ?? "0"}`, icon: <TrendingUp size={20} /> }
  ];

  return (
    <main className="admin-shell">
      <aside className="sidebar glass-panel">
        <div className="brand-lockup">
          <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" />
          <div>
            <strong>智算驿站</strong>
            <span>Admin Console</span>
          </div>
        </div>
        <nav>
          <NavButton active={view === "dashboard"} onClick={() => refresh("dashboard")} icon={<BarChart3 size={18} />}>经营看板</NavButton>
          <NavButton active={view === "users"} onClick={() => refresh("users")} icon={<Users size={18} />}>用户账户</NavButton>
          <NavButton active={view === "orders"} onClick={() => refresh("orders")} icon={<KeyRound size={18} />}>订单租赁</NavButton>
          <NavButton active={view === "resources"} onClick={() => refresh("resources")} icon={<Boxes size={18} />}>资源池</NavButton>
          <NavButton active={false} onClick={() => null} icon={<CircleDollarSign size={18} />}>结算</NavButton>
          <NavButton active={false} onClick={() => null} icon={<AlertTriangle size={18} />}>风控</NavButton>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar glass-panel">
          <div>
            <span className="eyebrow">Operations</span>
            <h1>运营控制台</h1>
            <p>监控供需状态、订单租赁、资源池健康度与收益结算。</p>
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => refresh()}><RefreshCw size={18} />刷新</button>
            <button className="ghost" onClick={() => { clearAdminToken(); setLoggedIn(false); }}>退出</button>
          </div>
        </header>

        {message && <div className="notice glass-panel">{message}</div>}

        {view === "dashboard" ? (
          <>
            <section className="cards">
              {cards.map((card) => (
                <div className="metric-card" key={card.label}>
                  <div className="metric-icon">{card.icon}</div>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </section>
            <section className="content-grid">
              <div className="panel glass-panel">
                <span className="eyebrow">Settlement</span>
                <h2>经营摘要</h2>
                <table>
                  <tbody>
                    <tr><td>待提现</td><td>{dashboard?.pendingWithdrawals ?? 0}</td></tr>
                    <tr><td>用量记录</td><td>{dashboard?.usageCount ?? 0}</td></tr>
                    <tr><td>供给方收益</td><td>${dashboard?.supplierIncome ?? "0"}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="panel glass-panel">
                <span className="eyebrow">Risk Signal</span>
                <h2>系统状态</h2>
                <div className="health-row"><CheckCircle2 size={18} />业务 API 正常</div>
                <div className="health-row"><ShieldCheck size={18} />Sub2API 调度在线</div>
              </div>
            </section>
          </>
        ) : (
          <DataPanel view={view} rows={rows} />
        )}
      </section>
    </main>
  );
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function DataPanel({ view, rows }: { view: View; rows: Row[] }) {
  const titleMap: Record<View, string> = {
    dashboard: "经营看板",
    users: "用户账户",
    orders: "订单租赁",
    resources: "资源池"
  };
  return (
    <div className="panel glass-panel wide">
      <div className="section-head">
        <div>
          <span className="eyebrow">Data Table</span>
          <h2>{titleMap[view]}</h2>
        </div>
        <strong>{rows.length} 条</strong>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>邮箱/资源</th><th>状态</th><th>金额</th><th>创建时间</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td>{row.email ?? row.resourceType ?? "-"}</td>
              <td>{row.status ? <StatusPill status={row.status} /> : "-"}</td>
              <td>{row.totalAmount ?? "-"}</td>
              <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "-"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

createRoot(document.getElementById("root")!).render(<App />);
