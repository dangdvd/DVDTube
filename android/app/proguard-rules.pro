# Shrink unused library code only: no renaming, and keep all of the app's own classes
# (some are referenced by name from the manifest, WorkManager or WebView).
-dontobfuscate
-keep class com.dangdvd.dvdtube.** { *; }
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
