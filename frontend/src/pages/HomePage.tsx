import {
  ArrowLeft,
  Building2,
  ChevronDown,
  CircleCheck,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

const popularPlaces = ["تهران", "کرج", "مشهد", "شیراز"] as const;

export function HomePage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-content">
          <p className="eyebrow">
            <Sparkles aria-hidden="true" /> جست‌وجوی ساده، انتخاب مطمئن
          </p>
          <h1 id="hero-title">خانه‌ای برای اجاره پیدا کنید</h1>
          <p className="hero-lead">
            آگهی‌های اجاره را از چند منبع، یک‌جا و با اطلاعات یکدست ببینید.
          </p>

          <form
            className="search-panel"
            action="/search"
            method="get"
            role="search"
          >
            <label className="search-field">
              <span>شهر یا محله</span>
              <span className="search-input-wrap">
                <MapPin aria-hidden="true" />
                <input
                  type="search"
                  name="location"
                  aria-label="شهر یا محله"
                  placeholder="مثلاً تهران، سعادت‌آباد"
                />
              </span>
            </label>
            <label className="search-field search-select">
              <span>نوع ملک</span>
              <span className="search-input-wrap">
                <Building2 aria-hidden="true" />
                <select name="property_type" defaultValue="">
                  <option value="">همه ملک‌ها</option>
                  <option value="apartment">آپارتمان</option>
                  <option value="house">خانه</option>
                </select>
                <ChevronDown className="select-chevron" aria-hidden="true" />
              </span>
            </label>
            <Button className="search-submit" type="submit">
              <Search aria-hidden="true" /> جست‌وجوی خانه
            </Button>
          </form>

          <div className="popular-places" aria-label="جست‌وجوهای پرطرفدار">
            <span>پرطرفدار:</span>
            {popularPlaces.map((place) => (
              <a
                key={place}
                href={`/search?location=${encodeURIComponent(place)}`}
              >
                {place}
              </a>
            ))}
          </div>
        </div>

        <aside
          className="surface surface--card trust-card"
          aria-label="مزیت‌های ترب‌رنت"
        >
          <div className="trust-illustration" aria-hidden="true">
            <div className="building building-back" />
            <div className="building building-front">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="key-disc">
              <ShieldCheck />
            </div>
          </div>
          <h2>با خیال راحت انتخاب کنید</h2>
          <ul>
            <li>
              <CircleCheck aria-hidden="true" /> آگهی‌های به‌روز از چند منبع
            </li>
            <li>
              <CircleCheck aria-hidden="true" /> اطلاعات شفاف و قابل مقایسه
            </li>
            <li>
              <CircleCheck aria-hidden="true" /> جست‌وجوی سریع و بی‌واسطه
            </li>
          </ul>
          <Link className="text-link" to="/guide">
            راهنمای پیدا کردن خانه <ArrowLeft aria-hidden="true" />
          </Link>
        </aside>
      </section>

      <section className="steps" aria-labelledby="steps-title">
        <div>
          <p className="section-kicker">چطور کار می‌کند؟</p>
          <h2 id="steps-title">سه قدم تا خانه بعدی</h2>
        </div>
        <ol>
          <li>
            <span>۱</span>
            <div>
              <h3>محله را انتخاب کنید</h3>
              <p>مقصد و نیازهای اصلی‌تان را مشخص کنید.</p>
            </div>
          </li>
          <li>
            <span>۲</span>
            <div>
              <h3>آگهی‌ها را مقایسه کنید</h3>
              <p>شرایط اجاره و ویژگی‌های ملک را یکدست ببینید.</p>
            </div>
          </li>
          <li>
            <span>۳</span>
            <div>
              <h3>با منبع آگهی تماس بگیرید</h3>
              <p>برای بازدید، مستقیم از مسیر همان آگهی ادامه دهید.</p>
            </div>
          </li>
        </ol>
      </section>
    </main>
  );
}
