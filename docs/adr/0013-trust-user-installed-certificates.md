# Trust certificates the user installs, so self-hosters can use self-signed or private CAs

The Android app trusts the system CAs and the CAs the user installs on the phone, through a network security config written by `apps/mobile/plugins/withNetworkSecurityConfig.js`. Cleartext `http://` stays blocked in every build. Self-hosters install their CA under Settings › Security & privacy › Encryption & credentials, then point the app at `https://` as usual.

We chose this because it's how other self-hosted apps handle private certificates, and because the alternative of trusting one CA baked into the APK would only work for one person's server and would ship that CA to everyone.

## Considered Options

- **Bake one CA into the APK.** Rejected: it works for one server only, and every public download would trust that CA.
- **Accept any certificate, or allow self-signed certificates in the app.** Rejected: it would also accept an attacker's certificate, and in a release build it would bypass checks the user can't see.
- **Pin each server's certificate in the app (trust on first use).** Deferred: it needs a native trust manager and a way to handle certificate renewal. It's the next step if installing a CA turns out to be too much for users.

## Consequences

- Anyone who installs a CA on the phone can read traffic from the app. That's the same trust the user already gives to other apps, and it's their device, but it's worth documenting in the README.
- A self-hosted server must still serve a complete certificate chain and be reachable under the name on the certificate.
- Plain `http://` still doesn't work in release builds (ADR-0012).
