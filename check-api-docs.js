/**
 * Consistency checks between the generated API artifacts and the route sources.
 * Run after `node build-api-docs.js`.
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "api-docs");
const spec = JSON.parse(fs.readFileSync(path.join(OUT, "mishwarak.openapi.json"), "utf8"));
const col = JSON.parse(fs.readFileSync(path.join(OUT, "mishwarak.postman_collection.json"), "utf8"));
const env = JSON.parse(fs.readFileSync(path.join(OUT, "mishwarak.postman_environment.json"), "utf8"));

let failures = 0;
const check = (label, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};

// 1. every internal $ref resolves
const schemas = new Set(Object.keys(spec.components.schemas));
const unresolved = [];
let refCount = 0;
JSON.stringify(spec).replace(/"\$ref":"([^"]+)"/g, (_, r) => {
    refCount++;
    if (r.startsWith("#/components/schemas/") && !schemas.has(r.split("/").pop())) unresolved.push(r);
});
check("all $refs resolve", unresolved.length === 0, `${refCount} refs, ${unresolved.length} unresolved`);

// 2. operationIds unique (Apidog uses them as request names)
const ops = Object.values(spec.paths).flatMap((p) => Object.values(p));
const ids = ops.map((o) => o.operationId);
check("operationIds unique", new Set(ids).size === ids.length, `${ids.length} ops`);

// 3. every path template parameter is declared
const missingParams = [];
for (const [key, methods] of Object.entries(spec.paths)) {
    const want = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const [m, op] of Object.entries(methods)) {
        const have = (op.parameters || []).filter((p) => p.in === "path").map((p) => p.name);
        if (!want.every((w) => have.includes(w))) missingParams.push(`${m.toUpperCase()} ${key}`);
    }
}
check("path params declared", missingParams.length === 0, missingParams.join(", "));

// 4. collection {{variables}} all exist in the environment
const envKeys = new Set(env.values.map((v) => v.key));
const used = new Set((JSON.stringify(col).match(/\{\{(\w+)\}\}/g) || []).map((s) => s.slice(2, -2)));
const undefinedVars = [...used].filter((u) => !envKeys.has(u));
check("no undefined collection variables", undefinedVars.length === 0, undefinedVars.join(", ") || `${used.size} used`);

// 5. URL is not doubled: {{baseUrl}} in host only
const authFolder = col.item.find((f) => f.name === "Auth");
const otpVerify = authFolder.item.find((i) => i.name === "POST /auth/otp/verify");
check("url not doubled", !otpVerify.request.url.path.includes("baseUrl"), otpVerify.request.url.host.join("") + "/" + otpVerify.request.url.path.join("/"));

// 6. token capture script present on the OTP verify request
const hasCapture = (otpVerify.event || []).some((e) => e.listen === "test" && /pm\.environment\.set\('token'/.test(e.script.exec.join("")));
check("otp/verify captures token", hasCapture);

// 6b. scripts live on the item, not inside request (Postman ignores the latter)
const nested = [];
for (const f of col.item) for (const i of f.item) if (i.request && i.request.event) nested.push(i.name);
check("scripts are on the item, not request", nested.length === 0, nested.join(", "));

// 6c. every script entry is non-empty and syntactically plausible
let badScript = 0;
const syntaxErrors = [];
for (const f of col.item) {
    for (const i of f.item) {
        for (const e of i.event || []) {
            if (!e.script || !Array.isArray(e.script.exec) || e.script.exec.length === 0) {
                badScript++;
                continue;
            }
            // A syntax error in a pre-request fails silently in Apidog, so parse
            // every script body here instead of discovering it at runtime.
            try {
                new Function("pm", "console", e.script.exec.join("\n"));
            } catch (err) {
                syntaxErrors.push(`${i.name} [${e.listen}]: ${err.message}`);
            }
        }
    }
}
check("all scripts non-empty", badScript === 0, `${badScript} empty`);
check("all scripts parse as valid JS", syntaxErrors.length === 0, syntaxErrors.slice(0, 3).join(" | "));

// 6e. 2FA endpoints must read the token from the cookie jar, since the
// controller only ever sets it there.
const verify2fa = authFolder.item.find((i) => i.name === "POST /auth/verify-2fa");
const readsCookie = (verify2fa.event || []).some((e) => e.script.exec.join("").includes("pm.cookies.get('token')"));
check("verify-2fa reads token from cookie", readsCookie);

// 6f. /auth/login returns no token - it must not claim to capture one
const loginReq = authFolder.item.find((i) => i.name === "POST /auth/login");
const loginCaptures = (loginReq.event || []).some((e) => e.script.exec.join("").includes("pm.environment.set('token'"));
check("login does not attempt token capture", !loginCaptures);
check("login captures userId for the 2FA step", (loginReq.event || []).some((e) => e.script.exec.join("").includes("pm.environment.set('userId'")));

// 6d. id capture scripts write the variables the body examples reference
const captureWrites = [];
for (const f of col.item) {
    for (const i of f.item) {
        for (const e of i.event || []) {
            if (e.listen !== "test") continue;
            for (const m of e.script.exec.join("\n").matchAll(/pm\.environment\.set\('(\w+)'/g)) captureWrites.push(m[1]);
        }
    }
}
check("id capture scripts present", captureWrites.filter((v) => v.endsWith("Id")).length >= 6, captureWrites.join(","));

// 7. multipart-only routes are not declared as JSON
const jsonOnly = [];
for (const [k, methods] of Object.entries(spec.paths)) {
    for (const [m, op] of Object.entries(methods)) {
        const ct = Object.keys(op.requestBody?.content || {});
        if (ct.includes("multipart/form-data") && ct.length > 1) jsonOnly.push(`${m} ${k}`);
    }
}
check("no mixed content-types on a body", jsonOnly.length === 0, jsonOnly.join(", "));

// 8. signup exposes the role flag in both artifacts, as multipart
const signupSpec = spec.paths["/auth/signup"].post.requestBody.content["multipart/form-data"].schema.properties.role;
const signupCol = authFolder.item.find((i) => i.name === "POST /auth/signup");
const signupFields = new Map((signupCol.request.body.formdata || []).map((f) => [f.key, f]));
check("signup role flag in OpenAPI", Array.isArray(signupSpec.enum) && signupSpec.enum.length === 2, signupSpec.enum.join("|"));
check("signup is multipart in collection", signupCol.request.body.mode === "formdata", signupCol.request.body.mode);
check("signup role sent as form field", signupFields.get("role") && signupFields.get("role").value === "driver", signupFields.get("role") && signupFields.get("role").value);
check("signup pic sent as file part", signupFields.get("pic") && signupFields.get("pic").type === "file");
check("signup phoneNumbers sent as JSON text", signupFields.get("phoneNumbers") && signupFields.get("phoneNumbers").value.startsWith("["));

// 9. protected endpoints actually require auth in the collection
const adminFolder = col.item.find((f) => f.name === "Admin");
const adminAuth = adminFolder.item.every((i) => (i.request.header || []).some((h) => h.key.toLowerCase() === "authorization"));
check("admin endpoints send Authorization header", adminAuth);

// 10. encoding: spec must be clean UTF-8 with no replacement characters
const raw = fs.readFileSync(path.join(OUT, "mishwarak.openapi.json"), "utf8");
check("no mojibake in spec", !raw.includes("\uFFFD"));

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);