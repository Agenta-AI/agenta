# 🚀 Quick Start - SSO/OIDC Testing

Get started testing in 5 minutes!

## 1️⃣ Start Services (1 minute)

Nothing to see, here.

## 2️⃣ Test Discovery (30 seconds)

```bash
curl -X POST http://localhost:8000/auth/discover \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

**Expected Response:**
```json
{
  "user_exists": false,
  "methods": {
    "email:otp": true,
    "sso": {
      "available": false,
      "required_by_some_orgs": false,
      "providers": []
    }
  }
}
```

## 3️⃣ Test OTP Flow (2 minutes)

1. Open browser: `http://localhost:8000/auth`
2. Enter email and click "Send OTP"
3. Check backend logs for OTP code (dev mode)
4. Enter code and submit
5. Verify in database:

```sql
SELECT * FROM user_identities WHERE method = 'email:otp' ORDER BY created_at DESC LIMIT 1;
```

**Expected:** New row with your email as subject

## 4️⃣ Verify Session (30 seconds)

After login, check session cookie contains identities:

```bash
# Get session from browser dev tools
# Cookie: sAccessToken=...
# Localhost/IP with explicit API port: sAccessToken_<port>=...

# Make authenticated request
curl http://localhost:8000/api/me \
  -H "Cookie: sAccessToken=<token>"
```

The backend should verify session and see `identities: ["email:otp"]`

---

## ✅ Basic Test Complete!

You've verified:
- ✅ Migrations applied
- ✅ Discovery endpoint works
- ✅ Email OTP login functional
- ✅ Identity tracking creates records
- ✅ Session contains identities array

## 🎯 Next Steps

### For OSS Mode Testing:
Continue with `01-discovery.http` tests

### For EE Mode Testing:
1. Switch to EE mode: `export AGENTA_LICENSE=ee`
2. Set up test organization (use SQL in `00-setup-verification.http`)
3. Configure SSO provider
4. Test with `02-oidc-authorize.http`

## 🐛 Something Not Working?

### Discovery returns error
- Check backend is running on port 8000
- Verify SuperTokens Core is accessible

### OTP not sent
- Check email provider configuration
- Look for OTP code in backend logs (dev mode)
- Verify SuperTokens Core connection

### Identity not created
- Check `user_identities` table exists
- Verify override functions registered
- Check backend logs for errors

### Need Help?
See `README.md` for detailed troubleshooting guide.
