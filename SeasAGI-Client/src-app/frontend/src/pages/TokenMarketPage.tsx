import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPlatformAPIBaseURL, getPlatformToken } from "../utils/commands";
import { useTranslation } from "../i18n";
import { useMarketStore } from "../stores/marketStore";

export function TokenMarketPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const marketListings = useMarketStore((s) => s.marketListings);
  const setMarketListings = useMarketStore((s) => s.setMarketListings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchListings = async (pageNum: number, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [baseURL, token] = await Promise.all([getPlatformAPIBaseURL(), getPlatformToken()]);
      const resp = await fetch(`${baseURL}/token-market/listings?page=${pageNum}&page_size=20`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const newItems = data.data || [];
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 1);
      if (append) {
        setMarketListings([...marketListings, ...newItems]);
      } else {
        setMarketListings(newItems);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchListings(1, false);
  }, []);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchListings(nextPage, true);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t("nav.tokenMarket")}</h1>
        <p className="page-subtitle">{t("tokenMarket.subtitle")}</p>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => navigate("/token-market/create")}>
            {t("tokenMarket.createListing")}
          </button>
          <button className="btn btn-secondary" onClick={() => navigate("/token-market/my-listings")}>
            {t("tokenMarket.myListings")}
          </button>
        </div>
      </div>

      {loading && <div className="loading-state">{t("common.loading")}</div>}
      {error && <div className="form-error">{error}</div>}

      {!loading && !error && marketListings.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🛒</div>
          <p>{t("tokenMarket.emptyMarket")}</p>
        </div>
      )}

      {!loading && !error && marketListings.length > 0 && (
        <>
          <div className="card-grid">
            {marketListings.map((listing) => (
              <div key={listing.listing_id} className="listing-card" onClick={() => navigate(`/token-market/listing/${listing.listing_id}`)} style={{ cursor: "pointer" }}>
                <div className="listing-card-header">
                  <span className="listing-label">{listing.token_label}</span>
                  <span className={`status-badge status-${listing.status}`}>
                    {listing.status === "active" ? t("tokenMarket.statusActive") : listing.status}
                  </span>
                </div>
                <div className="listing-card-body">
                  <div className="listing-row">
                    <span className="listing-key">{t("tokenMarket.seller")}</span>
                    <span className="listing-value">{listing.seller_username}</span>
                  </div>
                  <div className="listing-row">
                    <span className="listing-key">{t("tokenMarket.price")}</span>
                    <span className="listing-value price-value">
                      {listing.sale_type === "fixed_price"
                        ? `${listing.price} ${listing.currency}`
                        : `${(listing.discount_rate * 100).toFixed(0)}% ${t("tokenMarket.off")}`}
                    </span>
                  </div>
                  {listing.available_quota > 0 && (
                    <div className="listing-row">
                      <span className="listing-key">{t("tokenMarket.availableQuota")}</span>
                      <span className="listing-value">{listing.available_quota}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {page < totalPages && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? t("common.loading") : `${t("tokenMarket.loadMore")} (${marketListings.length}/${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
