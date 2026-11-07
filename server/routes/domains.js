import { Router } from "express";
import {
  listAllDomains,
  addDomainToWebsite,
  updateDomain,
  deleteDomain,
  issueDomainSsl,
  getWebsiteByName,
} from "../lib/domains.js";
import { clientIp } from "../middleware/auth.js";
import { getDb } from "../lib/db.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const domains = listAllDomains(req.actor?.orgId, req.actor?.role);
    res.json({ domains });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { siteName, domain, domainType, routingType, targetUrl, redirectCode, issueSsl } = req.body ?? {};
    if (!siteName) return res.status(400).json({ error: "siteName is required" });
    const site = getWebsiteByName(siteName);
    if (req.actor?.role !== "super_admin" && req.actor?.role !== "server_admin") {
      if (site.organization_id !== (req.actor?.orgId || "org_default")) {
        return res.status(403).json({ error: "Access denied to this website" });
      }
    }
    const result = await addDomainToWebsite(
      siteName,
      { domain, domainType, routingType, targetUrl, redirectCode, issueSsl },
      req.actor?.username,
      clientIp(req),
    );
    res.status(201).json({ ok: true, domain: result });
  } catch (error) {
    next(error);
  }
});

export default router;
