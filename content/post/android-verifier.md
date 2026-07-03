+++
title = "Decompiling the Android Developer Verifier app"
date = "2026-07-03"
+++

F-Droid blog has published an article
titled [What We Talk About When We Talk About Malware](https://f-droid.org/en/2026/07/01/adv-malware.html). The article
is rather critical and claims that a pre-loaded Android app called *Android Developer Verifier* behaves like a trojan
horse. The article contains little evidence for its claims. But I would like to give it credit for making me aware of the
app. This post is my analysis of the Android developer verification timeline, policy, and of the decompiled source code.

The Android Developer Verifier app's version 1.0 was released
in [July 2012](https://www.apkmirror.com/apk/google-inc/google-package-verifier/). Since October 2025, it has started
receiving more updates. This coincides with the post to an Android Developers Blog
titled [A new layer of security for certified Android devices](https://android-developers.googleblog.com/2025/08/elevating-android-security.html).
The blog states:
"Starting next year, Android will require all apps to be registered by verified developers in order to be installed by
users on certified Android devices."

The timeline of the rollout is reportedly:

|                    |                 |                                                                                                                                                                                                        |
|--------------------|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Announcement       | Aug 2025        | Google announces developer verification                                                                                                                                                                |
| Early access       | Oct 2025        | Developer verification early access begins. Invitations will be sent out gradually.                                                                                                                    |
| Verification opens | Mar 2026        | Verification opens for all developers.                                                                                                                                                                 |
| Enforcement begins | Sep 2026        | Requirements go into effect in Brazil, Indonesia, Singapore, and Thailand. At this point, any app installed on a certified Android device in these regions must be registered by a verified developer. |
| Global rollout     | 2027 and beyond | Requirements roll out globally.                                                                                                                                                                        |

Android 16, released in June 2025, introduces developer verification requirements.
The [release compatibility documentation](https://source.android.com/docs/compatibility/16/android-16-cdd#918_developer_verification)
contains useful info. I encourage you to read the original text. This is my summary of the relevant points:

- Android 16 devices that configure a developer verifier in **config.xml** must invoke **DeveloperVerifierService** for
  every package installation and update.
- The verifier service must prevent the installation of a package if the developer identity verification fails. Failure
  means the app is unverified.
- The verifier policy doesn't apply to installation via ADB. Or if developer verification policy is set to **FAIL_WARN**
  or
  **FAIL_OPEN**, verification is incomplete, *and* user clicks *install anyway*.

**DeveloperVerifierService** was introduced in Android 16, coinciding with the update of the Android Developer
Verifier app.

## Code analysis

{{<tip>}}APK: com.android.google.verifier version 1.0.866414232 from March 30{{</tip>}}

I decompiled the APK using [Dex to Java decompiler](https://github.com/skylot/jadx) that produces Java source code where
most
of the business logic is obfuscated. For a better look into the business
logic, [Apktool](https://github.com/ibotpeaches/apktool) decompiles the apk to smali code (type of assembly language)
which is not as easily readable.

     java -jar apktool_3.0.2.jar d com.google.android.verifier.apk

I tasked DeepSeek with analysing the decompiled code. Then, I verified the code execution path manually. I also
referenced my findings to this comprehensive [analysis](https://gist.github.com/agnostic-apollo/b8d8daa24cbdd216687a6bef53d417a6) someone already did.

## Findings

The **com.google.android.verifier** app is invoked before a package installation. It's a pre-installed,
system-privileged app that acts as the platform's developer verification service. It hosts the **DeveloperVerifierService**.

Once invoked, the verifier reads the policy. [[1]](#1-3)
Then, it extracts SHA-256 hashes of APK signing certificates. [[2]](#2)
It also collects installer identity, device serial number, device owner info and other basic information. It reports the
result back to the **PackageInstaller**. [[3]](#1-3)

The verification is local. The app pulls flags that originate from Google's server. [[4]](#4-flags-phenotypes) It
validates the signing
certificate fingerprints and reports them to **PackageInstaller**, a separate service, and it decides what to do based
on
the policy value:

- DEVELOPER_VERIFICATION_POLICY_NONE = 0: Do not block install.
- DEVELOPER_VERIFICATION_POLICY_BLOCK_FAIL_OPEN = 1: Block install when verification fails. If
  verifier can't be reached, let it through.
- DEVELOPER_VERIFICATION_POLICY_BLOCK_FAIL_WARN = 2: Warn user if verification fails, let them install
  anyway.
- DEVELOPER_VERIFICATION_POLICY_BLOCK_FAIL_CLOSED = 3: Block install when verification fails.

The app has two verification paths. The original enforcement approach works by sending the verificator result via gRPC
to the Play Store, which applies its
own policy. The new enforcement works by pulling policy flags from Google's servers to a local cached store and the
approach is delegated to **PackageInstallerSession**.

## Conclusion

The app verifier is a system app and can't be uninstalled. The **PackageInstaller** is invoked during install and if app
verifier is not present, it may or may not block the install. In any case, existing apps are not removed. However,
updates to
installed apps are checked. The new verification path is enabled by a flag pulled from Google server.

No network calls are made in the verification logic. For more context and ADB shell commands one
can use to debug this functionality, I recommend
reading
the [Android Developer Verification Discourse](https://gist.github.com/agnostic-apollo/b8d8daa24cbdd216687a6bef53d417a6).

---

## Reference

| Android Developer Verifier permissions |
|----------------------------------------|
| DEVELOPER_VERIFICATION_AGENT           |
| INTERACT_ACROSS_USERS                  |
| GET_ROLE_HOLDERS                       |
| MANAGE_USERS                           |
| READ_PRIVILEGED_PHONE_STATE            |
| ACCESS_NETWORK_STATE                   |
| INTERNET + ACCESS_NETWORK_STATE        |
| QUERY_ALL_PACKAGES                     |
| POST_NOTIFICATIONS                     |

#### [4] Flags (Phenotypes)

| Number   | Type  | Default | Index | File     | Description                                          |
|----------|-------|---------|-------|----------|------------------------------------------------------|
| 45681539 | long  | 0       | 1     | bgg.java | Platform policy - 0=NONE, 1=OPEN, 2=WARN, 3=CLOSED   |
| 45681540 | long  | 0       | 0     | bea.java | Backport policy - same values, gRPC                  |
| 45711407 | bool  | false   | 3     | wf.java  | Fingerprint matching on/off                          |
| 45711408 | bytes | ""      | 2     | ave.java | Developer registry - the allowlist                   |
| 45749715 | bool  | false   | 4     | wf.java  | Forced backport manager - short-circuit verification |

#### [1], [3]

```java
// helpers/verification/impl/common/platform/PlatformVerificationService.java
public final class PlatformVerificationService extends bgg {  
    public static final bny a = bny.h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationService");  
    public bgz b;  
    public bsx c;  
    public xv f;  
    public final Object d = new Object();  
    private final Map g = new LinkedHashMap();  
    public final Map e = new LinkedHashMap();  
  
    private final void c(final DeveloperVerificationSession developerVerificationSession, boolean z) {  
        Object objB;  
        Object objB2;  
        bgy bgyVar;  
        if (this.c == null) {  
            czl.a("timeSource");  
        }  
        Instant instantNow = Instant.now();  
        instantNow.getClass();  
        synchronized (this.d) {  
            bgz bgzVar = this.b;  
            if (bgzVar == null) {  
                czl.a("policyManager");  
                bgzVar = null;  
            }  
            int policy = developerVerificationSession.getPolicy();  
            long j = bgzVar.d;  
            int i = (int) j;  
            if (!bgz.b.contains(Integer.valueOf(i))) {  
                ((bnw) bgz.a.c().h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationPolicyManager$Companion", "parsePhenotypePolicy", 126, "PlatformVerificationPolicyManager.kt")).p("Invalid verification policy: %d.", j);  
                i = 0;  
            }  
            if (i == policy) {  
                bgyVar = new bgy(policy, i, i, i);  
            } else {  
                ((bnw) bgz.a.d().h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationPolicyManager", "updatePolicyIfNecessary", 49, "PlatformVerificationPolicyManager.kt")).w(policy, i);  
                PackageInstaller packageInstaller = bgzVar.c.getPackageManager().getPackageInstaller();  
                packageInstaller.getClass();  
                try {  
                    objB = Boolean.valueOf(packageInstaller.setDeveloperVerificationPolicy(i));  
                } catch (Throwable th) {  
                    objB = cvl.b(th);  
                }  
                boolean zBooleanValue = ((Boolean) (true != (objB instanceof cvu) ? objB : false)).booleanValue();  
                if (!zBooleanValue) {  
                    ((bnw) bgz.a.c().g(cvv.a(objB)).h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationPolicyManager", "updatePolicyIfNecessary", 56, "PlatformVerificationPolicyManager.kt")).n("Failed to update global policy.");  
                }  
                try {  
                    objB2 = Boolean.valueOf(developerVerificationSession.setPolicy(i));  
                } catch (Throwable th2) {  
                    objB2 = cvl.b(th2);  
                }  
                boolean zBooleanValue2 = ((Boolean) (true != (objB2 instanceof cvu) ? objB2 : false)).booleanValue();  
                if (!zBooleanValue2) {  
                    ((bnw) bgz.a.c().g(cvv.a(objB2)).h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationPolicyManager", "updatePolicyIfNecessary", 63, "PlatformVerificationPolicyManager.kt")).n("Failed to update session policy.");  
                }  
                bgyVar = new bgy(policy, i, true != zBooleanValue2 ? policy : i, true != zBooleanValue ? policy : i);  
            }  
            String packageName = developerVerificationSession.getPackageName();  
            if (packageName == null || czl.m(packageName)) {  
                ((bnw) a.c().h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationService", "onVerificationRequiredOrRetry", 116, "PlatformVerificationService.kt")).n("`onVerificationRequiredOrRetry` missing package name.");  
                try {  
                    developerVerificationSession.reportVerificationIncomplete(0);  
                } catch (Throwable th3) {  
                    cvl.b(th3);  
                }  
            } else {  
                Map map = this.e;  
                if (map.containsKey(Integer.valueOf(developerVerificationSession.getId()))) {  
                    ((bnw) a.d().h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationService", "onVerificationRequiredOrRetry", 126, "PlatformVerificationService.kt")).n("Multiple `onVerificationRequiredOrRetry` calls.");  
                    bgo bgoVar = (bgo) map.remove(Integer.valueOf(developerVerificationSession.getId()));  
                    if (bgoVar != null) {  
                        bgoVar.b("Multiple `onVerificationRequiredOrRetry` calls");  
                    }  
                }  
                final bgo bgoVarAl = (bgo) this.g.remove(developerVerificationSession.getPackageName());  
                if (bgoVarAl == null) {  
                    xv xvVarB = b();  
                    String packageName2 = developerVerificationSession.getPackageName();  
                    packageName2.getClass();  
                    bgoVarAl = xvVarB.al(packageName2);  
                }  
                cyr cyrVar = new cyr() { // from class: bha  
                    @Override // defpackage.cyr  
                    public final Object a(Object obj) {  
                        bgk bgkVar = (bgk) obj;  
                        bgkVar.getClass();  
                        DeveloperVerificationSession developerVerificationSession2 = developerVerificationSession;  
                        developerVerificationSession2.getPackageName();  
                        developerVerificationSession2.getId();  
                        bgo bgoVar2 = bgoVarAl;  
                        PlatformVerificationService platformVerificationService = this.a;  
                        synchronized (platformVerificationService.d) {  
                            Map map2 = platformVerificationService.e;  
                            bgo bgoVar3 = (bgo) map2.get(Integer.valueOf(developerVerificationSession2.getId()));  
                            if (czl.b(bgoVar3, bgoVar2)) {  
                                map2.remove(Integer.valueOf(developerVerificationSession2.getId()));  
                            } else if (bgoVar3 == null) {  
                                ((bnw) PlatformVerificationService.a.c().h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationService", "onVerificationResult", 184, "PlatformVerificationService.kt")).n("`onVerificationResult` for untracked verification");  
                            } else {  
                                ((bnw) PlatformVerificationService.a.c().h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationService", "onVerificationResult", 189, "PlatformVerificationService.kt")).n("`onVerificationResult` for unexpected verification");  
                            }  
                            // [3]
                            try {  
                                if (bgkVar instanceof bgi) {  
                                    DeveloperVerificationStatus developerVerificationStatus = ((bgi) bgkVar).a;  
                                    developerVerificationStatus.isVerified();  
                                    developerVerificationStatus.getFailureMessage();  
                                    developerVerificationSession2.reportVerificationComplete(developerVerificationStatus);  
                                } else if (bgkVar instanceof bgj) {  
                                    developerVerificationSession2.reportVerificationIncomplete(((bgj) bgkVar).a);  
                                } else {  
                                    if (!(bgkVar instanceof bgh)) {  
                                        throw new cvs();  
                                    }  
                                    developerVerificationSession2.reportVerificationBypassed(1);  
                                }  
                            } catch (Exception e) {  
                                ((bnw) PlatformVerificationService.a.c().g(e).h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationService", "onVerificationResult", 216, "PlatformVerificationService.kt")).n("Unexpect exception while reporting result");  
                            }  
                        }  
                        return cvz.a;  
                    }  
                };  
                bgoVarAl.e.M(developerVerificationSession);  
                bgoVarAl.f.M(Boolean.valueOf(z));  
                bgoVarAl.g.M(instantNow);  
                bgoVarAl.h.M(bgyVar);  
                bgoVarAl.i.M(cyrVar);  
                map.put(Integer.valueOf(developerVerificationSession.getId()), bgoVarAl);  
            }  
        }  
    }
```

#### [2]

```java
// defpackage/bgw.java
public static final List c(SigningInfo signingInfo) {  
    Signature[] apkContentsSigners;  
    int length;  
    try {  
        if (signingInfo == null) {  
            throw new IllegalArgumentException("`signingInfo` is null");  
        }  
        if (signingInfo.hasMultipleSigners()) {  
            apkContentsSigners = signingInfo.getApkContentsSigners();  
            if (apkContentsSigners == null) {  
                throw new IllegalArgumentException("`apkContentsSigners` is null");  
            }  
        } else {  
            Signature[] signingCertificateHistory = signingInfo.getSigningCertificateHistory();  
            Signature signature = null;  
            if (signingCertificateHistory != null && (length = signingCertificateHistory.length) != 0) {  
                signature = signingCertificateHistory[length - 1];  
            }  
            if (signature == null) {  
                throw new IllegalArgumentException("`signingCertificateHistory` is null or empty");  
            }  
            apkContentsSigners = new Signature[]{signature};  
        }  
        MessageDigest messageDigest = MessageDigest.getInstance("SHA-256");  
        messageDigest.getClass();  
        ArrayList arrayList = new ArrayList(apkContentsSigners.length);  
        for (Signature signature2 : apkContentsSigners) {  
            byte[] bArrDigest = messageDigest.digest(signature2.toByteArray());  
            bArrDigest.getClass();  
            arrayList.add(new bej(bArrDigest));  
        }  
        return arrayList;  
    } catch (Exception e) {  
        ((bnw) a.d().g(e).h("com/google/android/verifier/helpers/verification/impl/common/platform/PlatformVerificationMapping", "toCertFingerprints", 220, "PlatformVerificationMapping.kt")).n("Unable to parse certs. Defaulting to empty list.");  
        return cwk.a;  
    }  
}
```