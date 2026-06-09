import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Copy,
  CreditCard,
  KeyRound,
  Layers3,
  LockKeyhole,
  Package,
  Power,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X
} from "lucide-react";
import { API_BASE, api, clearToken, saveToken } from "./api";
import logoUrl from "../assets/zyz-logo.png";
import "../styles/main.css";

type View = "dashboard" | "products" | "rentals" | "wallet" | "supplier";
type AuthMode = "login" | "register" | null;
type OAuthProvider = "google" | "x";

interface User {
  id: string;
  email: string;
  displayName?: string | null;
  roles: string[];
}

interface WalletAccount {
  availableBalance: string;
  frozenBalance: string;
  totalSpent: string;
}

interface ProductPrice {
  id: string;
  displayName: string;
  fixedPrice: string;
  durationDays?: number;
  maxConcurrency: number;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  requestLimit?: number | null;
  spendLimit?: string | null;
}

interface Product {
  id: string;
  name: string;
  resourceType: string;
  description?: string;
  prices: ProductPrice[];
}

interface Rental {
  id: string;
  resourceType: string;
  status: string;
  endpointUrl?: string;
  sub2KeyId?: string;
  endsAt?: string;
}

interface SupplierResource {
  id: string;
  resourceType: string;
  status: string;
  level: string;
  maxConcurrency: number;
}

interface AuthCapabilities {
  passwordAuth: boolean;
  oauth: {
    google: boolean;
    x: boolean;
  };
}

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities>({
    passwordAuth: false,
    oauth: { google: true, x: true }
  });
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [resources, setResources] = useState<SupplierResource[]>([]);
  const [message, setMessage] = useState("");
  const [lastApiKey, setLastApiKey] = useState("");
  const [loading, setLoading] = useState(false);

  const activeRental = useMemo(() => rentals.find((rental) => rental.status === "active"), [rentals]);

  async function refresh() {
    if (!localStorage.getItem("zyz_token")) return;
    setLoading(true);
    try {
      const [me, walletData, productData, rentalData] = await Promise.all([
        api<User>("/api/me"),
        api<WalletAccount>("/api/wallet"),
        api<Product[]>("/api/products"),
        api<Rental[]>("/api/rentals")
      ]);
      setUser(me);
      setWallet(walletData);
      setProducts(productData);
      setRentals(rentalData);
      if (me.roles.includes("supplier")) {
        const supplier = await api<{ resources: SupplierResource[] }>("/api/supplier/profile").catch(() => null);
        setResources(supplier?.resources ?? []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("auth_token");
    const error = params.get("auth_error");

    if (token) {
      saveToken(token);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setMessage("登录成功");
      void refresh();
      return;
    }

    if (error) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setMessage(`第三方登录失败：${error}`);
    }

    api<AuthCapabilities>("/api/auth/capabilities").then(setAuthCapabilities).catch(() => null);
    void refresh();
  }, []);

  function startOAuth(provider: OAuthProvider) {
    window.location.href = `${API_BASE}/api/auth/oauth/${provider}/start`;
  }

  async function passwordAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const path = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await api<{ token: string; user: User }>(path, {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        displayName: form.get("displayName")
      })
    });
    saveToken(result.token);
    setUser(result.user);
    setAuthMode(null);
    setMessage(authMode === "register" ? "账号已创建" : "登录成功");
    await refresh();
  }

  async function recharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/wallet/recharge", { method: "POST", body: JSON.stringify({ amount: form.get("amount") }) });
    setMessage("充值成功");
    await refresh();
  }

  async function buy(productId: string, priceId: string) {
    setLoading(true);
    try {
      const idempotencyKey = createIdempotencyKey();
      const result = await api<{ apiKey: string }>("/api/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ productId, priceId, idempotencyKey })
      });
      setLastApiKey(result.apiKey);
      setMessage("资源已开通，新的 API Key 只显示一次");
      await refresh();
      setView("rentals");
    } finally {
      setLoading(false);
    }
  }

  async function rotateRentalKey(rentalId: string) {
    setLoading(true);
    try {
      const result = await api<{ apiKey: string; oldSub2KeyDisabled: boolean }>(`/api/rentals/${rentalId}/rotate-key`, {
        method: "POST"
      });
      setLastApiKey(result.apiKey);
      setMessage(`API key rotated. Copy the new key now.${result.oldSub2KeyDisabled ? "" : " Old Sub2 key disable needs support check."}`);
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function applySupplier() {
    await api("/api/supplier/apply", { method: "POST", body: JSON.stringify({ displayName: user?.displayName ?? user?.email }) });
    setMessage("供给方身份已开通");
    await refresh();
  }

  async function createResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/supplier/resources", {
      method: "POST",
      body: JSON.stringify({
        resourceType: form.get("resourceType"),
        maxConcurrency: form.get("maxConcurrency"),
        reserveRatio: form.get("reserveRatio")
      })
    });
    setMessage("资源已提交，等待测试与审核");
    await refresh();
  }

  if (!user) {
    return (
      <>
        <PublicSite onAuth={setAuthMode} />
        {authMode && (
          <AuthDialog
            mode={authMode}
            capabilities={authCapabilities}
            message={message}
            onClose={() => setAuthMode(null)}
            onOAuth={startOAuth}
            onPasswordAuth={passwordAuth}
          />
        )}
      </>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar surface">
        <Brand small />
        <nav>
          <NavButton icon={<Activity size={18} />} active={view === "dashboard"} onClick={() => setView("dashboard")}>总览</NavButton>
          <NavButton icon={<Package size={18} />} active={view === "products"} onClick={() => setView("products")}>套餐</NavButton>
          <NavButton icon={<KeyRound size={18} />} active={view === "rentals"} onClick={() => setView("rentals")}>密钥</NavButton>
          <NavButton icon={<Wallet size={18} />} active={view === "wallet"} onClick={() => setView("wallet")}>钱包</NavButton>
          <NavButton icon={<Power size={18} />} active={view === "supplier"} onClick={() => setView("supplier")}>供给</NavButton>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar surface">
          <div>
            <span className="kicker">Workspace</span>
            <h1>{user.displayName || user.email}</h1>
            <p>管理租赁通道、接口密钥、钱包余额与供给资源。</p>
          </div>
          <div className="actions">
            <button className="secondary" onClick={refresh}><RefreshCw size={18} />刷新</button>
            <button className="ghost" onClick={() => { clearToken(); location.reload(); }}>退出</button>
          </div>
        </header>

        {message && <div className="notice surface">{message}</div>}
        {loading && <div className="notice surface">正在处理请求...</div>}

        {view === "dashboard" && <Dashboard wallet={wallet} rentals={rentals} activeRental={activeRental} resources={resources} />}
        {view === "products" && <Products products={products} onBuy={buy} />}
        {view === "rentals" && <Rentals rentals={rentals} lastApiKey={lastApiKey} onRotateKey={rotateRentalKey} />}
        {view === "wallet" && <WalletPage wallet={wallet} onRecharge={recharge} />}
        {view === "supplier" && <SupplierPage user={user} resources={resources} onApply={applySupplier} onCreateResource={createResource} />}
      </section>
    </main>
  );
}

function PublicSite({ onAuth }: { onAuth: (mode: AuthMode) => void }) {
  return (
    <main className="site">
      <header className="site-nav">
        <Brand />
        <nav>
          <a href="#platform">平台</a>
          <a href="#resources">资源</a>
          <a href="#supplier">供给方</a>
          <button className="text-button" onClick={() => onAuth("login")}>登录</button>
          <button onClick={() => onAuth("register")}>开始使用</button>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="kicker">闲置额度租赁平台</span>
          <h1>租闲置额度，跑 AI 任务。</h1>
          <p>供给方出租不用的 Codex、Claude Code、Gemini 与 Antigravity 额度；使用方按需租用，以更低成本获得可用的 coding agent 能力。</p>
          <div className="hero-actions">
            <button onClick={() => onAuth("register")}>开始使用<ArrowRight size={18} /></button>
            <button className="secondary" onClick={() => onAuth("login")}>登录控制台</button>
          </div>
        </div>
        <div className="product-preview surface">
          <div className="preview-head">
            <span>智算驿站 / routing</span>
            <span className="status-dot">online</span>
          </div>
          <div className="preview-metrics">
            <Metric label="资源类型" value="4" />
            <Metric label="目标成本" value="20%" />
            <Metric label="供给返还" value="90%" />
          </div>
          <div className="terminal-card">
            <span>Endpoint</span>
            <code>https://gateway.example/v1</code>
          </div>
        </div>
      </section>

      <section id="platform" className="statement">
        <h2>让闲置额度变成可租赁、可分发、可结算的资源。</h2>
      </section>

      <section id="resources" className="feature-grid">
        <Feature icon={<Layers3 />} title="租用额度" text="使用方选择套餐后，平台自动分发 Endpoint 与 Key，把闲置额度转成可用接口。" />
        <Feature icon={<LockKeyhole />} title="隔离密钥" text="每笔租赁独立状态、独立到期、独立密钥记录，便于停用、续租与核算。" />
        <Feature icon={<ShieldCheck />} title="业务管控" text="钱包余额、套餐价格、资源状态和订单生命周期都由平台统一承接。" />
      </section>

      <section id="supplier" className="split-section">
        <div>
          <span className="kicker">For suppliers</span>
          <h2>把不用的额度租出去，让需要的人租进来。</h2>
        </div>
        <p>供给方开通身份后提交资源，平台进入测试、分级、上线和结算流程。运营后台可查看资源池、订单、用户与收益数据。</p>
      </section>

      <section className="bottom-cta">
        <h2>开始租赁闲置额度。</h2>
        <button onClick={() => onAuth("register")}>创建账号<ArrowRight size={18} /></button>
      </section>
    </main>
  );
}

function AuthDialog({ mode, capabilities, message, onClose, onOAuth, onPasswordAuth }: {
  mode: Exclude<AuthMode, null>;
  capabilities: AuthCapabilities;
  message: string;
  onClose: () => void;
  onOAuth: (provider: OAuthProvider) => void;
  onPasswordAuth: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const hasOAuth = capabilities.oauth.google || capabilities.oauth.x;
  return (
    <div className="auth-overlay" role="dialog" aria-modal="true">
      <section className="auth-dialog surface">
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <Brand />
        <div>
          <h2>{mode === "register" ? "创建智算驿站账号" : "登录智算驿站"}</h2>
          <p>{capabilities.passwordAuth ? "使用邮箱密码进入租赁和供给工作台。" : "使用 Google 或 X 账号进入租赁和供给工作台。"}</p>
        </div>
        {message && <div className="notice compact">{message}</div>}
        {capabilities.passwordAuth && (
          <form className="auth-form" onSubmit={onPasswordAuth}>
            {mode === "register" && <input name="displayName" placeholder="显示名称" />}
            <input name="email" type="email" placeholder="邮箱" required />
            <input name="password" type="password" placeholder="密码" minLength={8} required />
            <button>{mode === "register" ? "创建账号" : "登录"}</button>
          </form>
        )}
        {hasOAuth && (
          <div className="oauth-options">
            {capabilities.oauth.google && (
              <button className="oauth-button" onClick={() => onOAuth("google")}>
                <span className="oauth-icon">G</span>
                继续使用 Google
              </button>
            )}
            {capabilities.oauth.x && (
              <button className="oauth-button dark" onClick={() => onOAuth("x")}>
                <span className="oauth-icon">X</span>
                继续使用 X
              </button>
            )}
          </div>
        )}
        <p className="auth-terms">登录即代表你同意平台服务条款和隐私政策。</p>
      </section>
    </div>
  );
}

function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "brand-small" : ""}`}>
      <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" />
      <div>
        <strong>智算驿站</strong>
        <span>Compute Relay</span>
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>;
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <article className="feature surface"><div>{icon}</div><h3>{title}</h3><p>{text}</p></article>;
}

function Dashboard({ wallet, rentals, activeRental, resources }: { wallet: WalletAccount | null; rentals: Rental[]; activeRental?: Rental; resources: SupplierResource[] }) {
  return (
    <>
      <section className="metrics">
        <Metric label="可用余额" value={`$${wallet?.availableBalance ?? "0.00"}`} />
        <Metric label="有效租赁" value={rentals.filter((rental) => rental.status === "active").length} />
        <Metric label="累计消费" value={`$${wallet?.totalSpent ?? "0.00"}`} />
        <Metric label="供给资源" value={resources.length} />
      </section>
      <section className="content-grid">
        <div className="panel surface wide-card">
          <span className="kicker">Current endpoint</span>
          <h2>{activeRental ? "租赁通道已就绪" : "暂无有效租赁"}</h2>
          <code>{activeRental?.endpointUrl ?? "购买套餐后自动生成 Endpoint 与 API Key"}</code>
        </div>
        <div className="panel surface">
          <span className="kicker">Status</span>
          <h2>调度概览</h2>
          <p>有效租赁 {rentals.filter((rental) => rental.status === "active").length} 个，供给资源 {resources.length} 个。</p>
        </div>
      </section>
    </>
  );
}

function Products({ products, onBuy }: { products: Product[]; onBuy: (productId: string, priceId: string) => void }) {
  return (
    <section className="content-grid">
      {products.map((product) => (
        <Fragment key={product.id}>
          {product.prices.map((price) => (
            <div className="product-card surface" key={price.id}>
              <div className="product-head">
                <div>
                  <span className="kicker">{product.resourceType}</span>
                  <h2>{product.name}</h2>
                </div>
                <strong>${price.fixedPrice}</strong>
              </div>
              <p>{product.description}</p>
              <dl>
                <dt>套餐</dt><dd>{price.displayName}</dd>
                <dt>周期</dt><dd>{price.durationDays ?? "-"} 天</dd>
                <dt>并发</dt><dd>{price.maxConcurrency}</dd>
                <dt>RPM</dt><dd>{price.rpmLimit ?? "不限"}</dd>
                <dt>TPM</dt><dd>{price.tpmLimit ?? "不限"}</dd>
                <dt>请求量</dt><dd>{price.requestLimit ?? "不限"}</dd>
                <dt>消费上限</dt><dd>{price.spendLimit ?? "不限"}</dd>
              </dl>
              <button onClick={() => onBuy(product.id, price.id)}>购买并开通<ArrowRight size={18} /></button>
            </div>
          ))}
        </Fragment>
      ))}
    </section>
  );
}

function Rentals({ rentals, lastApiKey, onRotateKey }: { rentals: Rental[]; lastApiKey: string; onRotateKey: (rentalId: string) => void }) {
  return (
    <section className="panel surface wide">
      <div className="section-head">
        <div>
          <span className="kicker">API Access</span>
          <h2>租赁与密钥</h2>
        </div>
        {lastApiKey && <button className="secondary" onClick={() => navigator.clipboard?.writeText(lastApiKey)}><Copy size={18} />复制新 Key</button>}
      </div>
      {lastApiKey && <code className="key-display">{lastApiKey}</code>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>资源</th><th>状态</th><th>Endpoint</th><th>到期</th><th>Sub2 Key</th><th>操作</th></tr></thead>
          <tbody>
            {rentals.map((rental) => (
              <tr key={rental.id}>
                <td>{rental.resourceType}</td>
                <td><StatusPill status={rental.status} /></td>
                <td>{rental.endpointUrl ?? "-"}</td>
                <td>{rental.endsAt ? new Date(rental.endsAt).toLocaleString() : "-"}</td>
                <td>{rental.sub2KeyId ?? "-"}</td>
                <td><button className="secondary" disabled={rental.status !== "active"} onClick={() => onRotateKey(rental.id)}>Rotate Key</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WalletPage({ wallet, onRecharge }: { wallet: WalletAccount | null; onRecharge: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <section className="content-grid">
      <div className="panel surface">
        <span className="kicker">Wallet</span>
        <h2>钱包资产</h2>
        <div className="balance">${wallet?.availableBalance ?? "0.00"}</div>
        <p>冻结余额：${wallet?.frozenBalance ?? "0.00"}</p>
      </div>
      <form className="panel surface" onSubmit={onRecharge}>
        <span className="kicker">Recharge</span>
        <h2>充值</h2>
        <input name="amount" type="number" min="10" step="0.01" defaultValue="20" />
        <button><CreditCard size={18} />确认充值</button>
      </form>
    </section>
  );
}

function SupplierPage({ user, resources, onApply, onCreateResource }: {
  user: User;
  resources: SupplierResource[];
  onApply: () => void;
  onCreateResource: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isSupplier = user.roles.includes("supplier");
  if (!isSupplier) {
    return (
      <section className="panel surface supplier-hero">
        <span className="kicker">Supplier network</span>
        <h2>开通供给方工作台</h2>
        <p>提交闲置订阅资源后，平台会进入测试、分级、上线与结算流程。</p>
        <button onClick={onApply}>申请成为供给方<ArrowRight size={18} /></button>
      </section>
    );
  }
  return (
    <section className="content-grid">
      <form className="panel surface" onSubmit={onCreateResource}>
        <span className="kicker">New resource</span>
        <h2>新增供给资源</h2>
        <select name="resourceType" defaultValue="codex">
          <option value="codex">Codex</option>
          <option value="claude_code">Claude Code</option>
          <option value="gemini">Gemini</option>
          <option value="antigravity">Antigravity</option>
        </select>
        <input name="maxConcurrency" type="number" min="1" max="20" defaultValue="1" />
        <input name="reserveRatio" type="number" min="0" max="1" step="0.05" defaultValue="0.2" />
        <button>提交资源</button>
      </form>
      <div className="panel surface wide-card">
        <span className="kicker">Resource pool</span>
        <h2>资源列表</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>资源</th><th>状态</th><th>等级</th><th>并发</th></tr></thead>
            <tbody>{resources.map((resource) => <tr key={resource.id}><td>{resource.resourceType}</td><td><StatusPill status={resource.status} /></td><td>{resource.level}</td><td>{resource.maxConcurrency}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{status === "active" || status === "online" ? <CheckCircle2 size={14} /> : null}{status}</span>;
}

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

createRoot(document.getElementById("root")!).render(<App />);
