+++
title = "From Jar to Native Cross-Platform Java with pipeline"
date = "2024-09-18"
+++

Java has come a long way. At the moments when I consider which stack is best suited for a new project, Java's lack of good distribution options causes me to hesitate. New technologies in the Java ecosystem as well as from the broader scope can greatly help. Here, I will share how I built a pipeline to automate the distribution of my Java project.

---

### Motivation

Everyone has to start somewhere. When I began developing my app, I did so with the "next generation" JavaFX. In retrospect, it was the correct choice, if only for the lessons learned. I will describe the old distribution solution to give you a sense of how things have improved since.

Java code is compiled and packaged into a jar that can be simply distributed for systems with a JRE. That was my hopeful reasoning. JRE is no [longer provided](https://docs.oracle.com/en/java/javase/11/migrate/index.html) and JavaFX is not a part of the JDK since [version 11](<(https://www.oracle.com/java/technologies/javase/11-relnote-issues.html)>). And the dependencies were not present in the jar I was trying to export. Some of these issues were solved by specifying manifests, source directories and other uninteresting bits. I learned that what I needed was a fat / shaded / uber jar. A [fat jar](https://dzone.com/articles/the-skinny-on-fat-thin-hollow-and-uber) means including the app's dependencies in the jar. Newer solutions like [executable Spring jar](https://docs.spring.io/spring-boot/docs/3.2.7-SNAPSHOT/reference/html/executable-jar.html) are essentially that.

In any case, JavaFX [requires a JDK](https://openjfx.io/openjfx-docs/). Furthermore, I wanted to distribute an exe file. Converting jar to an exe is no easy feat. [Launch4j](https://launch4j.sourceforge.net/) is a tool made for this task. My attempts to create exe up to spec failed and I ended up with a hardcoded JDK path. For convenience, I made an installer in [InnoSetup](https://jrsoftware.org/isinfo.php). I consider creating installers from ground up a waste of time.

It soon appeared that my installer's JDK path picker did nothing at all, and the exe searched exclusively at {{<code>}}C:/Program Files/Java/jdk-20{{</code>}}. It was at this time that I had a better overview and also reached the limits of JavaFX. JavaFX does not have superior performance, obvious cross-platform distribution nor inspiring GUI looks. It is relatively easy to hack together, with the UI code in an adjacent Java class. RAM consumption was ~100 MB, even after heap size adjustment in Launch4j. The baggage of JDK was also something I wanted to avoid.

---

### Tech stack

Replacing the JavaFX GUI meant stepping outside the Java ecosystem and turning to a JavaScript frontend framework like Angular, React, Vue.js. Developing a web interface with these tools comes with many benefits. I decided to use Vue.js with Vite for the frontend, paired with Spring Boot for the backend.

In this setup, frontend and backend run on separate local servers. For this post I will use Spring Tomcat server's [default port](https://docs.spring.io/spring-boot/docs/1.3.0.RELEASE/reference/html/howto-properties-and-configuration.html) 8080. Likewise, Vite in the frontend provides a server that serves the Vue.js files at 5173. These two local servers communicate via HTTP. To view the GUI itself, it's as easy as visiting localhost:5173 in a browser.

Switching from JavaFX to Vue.js also allowed me to drop the need for the JDK. Vite handles building optimized static files for the frontend, which are then placed in the {{<code>}}dist/{{</code>}} directory. These files exported to {{<code>}}dist/{{</code>}} are moved over to {{<code>}}src/main/resources/static{{</code>}} so that the backend server can serve them at 8080.

### GraalVM

Not long after, I came across [GraalVM](https://www.graalvm.org/). For my use case, it can compile code to a native executable (exe on Windows). It is a distinct JDK with ahead-of-time compilation. The compilation time is longer but the result is a program with no warmup time. Graal generated executable starts almost instantly. Generally, GraalVM's primary use is for microservice architectures to reduce the cloud bills.

---

### What to automate

I pivoted to these technologies and even made a new [NSIS](https://nsis.sourceforge.io/Main_Page) installer. The state of my app was better than before, but the manual steps of distribution were still many:

- Build static frontend files.
- Move these files to {{<code>}}/resources/static{{</code>}}.
- Start native compilation.
- Use external tool to embed an icon.
- Move the executable to a special folder.
- Update the installer script.
- Start the installer packaging script.
- Go back to build the bootJar for other platforms.
- Finally, upload and make a release.

It goes without saying that a human is inefficient and unreliable at performing repeated tasks. Any discovered defect meant that I needed to do the steps again. A lot of time was wasted. [Automated pipelines](https://goodreads.com/book/show/56771495-continuous-delivery-pipelines---how-to-build-better-software-faster) come to the rescue. Over time, I automated most of the steps so that my input is reduced to more or less one click.

A good first step is to set the [output dir](https://vitejs.dev/config/build-options#build-outdir) in {{<code>}}vite.config.js{{</code>}} or equivalent config. I pointed it to the backend location so that I don't have to copy the static files manually.

```javascript
export default defineConfig({
    plugins: [vue()],
    build: {
        outDir: "../src/main/resources/static",
    },
```

### Electron

My app previously used the browser for rendering its UI. While a valid offloading approach, it creates more friction for users. I used the opportunity and integrated Electron. As you will see, Electron-related tools bring convenient functions for distribution.

Electron integration means some new files and {{<code>}}package.json{{</code>}} additions. First, the [electron-builder](https://github.com/electron/forge) I use, and its alternative [electron forge](https://github.com/electron/forge), need the following in {{<code>}}package.json{{</code>}}.

    "author": "BLCK",
    "name": "mrt",
    "version": "9.1.0",
    "description": "MusicReleaseTracker",
    "main": "electron-main.js",

Name can't contain capital letters. Version has to be in the semantic versioning format. {{<code>}}main{{</code>}} points to the entry point of electron. I recommend giving it an obvious name, so it cannot get confused with other main.js, index.js and config.js files.

In the script section, one can specify simple scripts and their names. To run electron for development I type {{<code>}}npm run electron{{</code>}}. The script {{<code>}}distExe{{</code>}} packages an executable and {{<code>}}distInstaller{{</code>}} also creates an installer.

    "scripts": {
        "dev": "vite",
        "buildVue": "vite build",
        "preview": "vite preview",
        "electron": "electron .",
        "distExe": "electron-builder --dir",
        "distInstaller": "electron-builder"
    },

---

### The pipe

The pipeline is made in [GitHub actions](https://docs.github.com/en/actions/writing-workflows/quickstart). You may need some knowledge of the syntax to fully understand the code.

<img src="/java-native-pipe/pipegit.png" width="500" style="border-radius: 6px;" alt="Github pipeline">

We want to create some reference for testing because native compilation is expensive. So, optionally only the jar can be built. Native executables are built for the three operating systems, and only after all builds pass, a release is drafted.

```yaml
name: distribution
on:
  workflow_dispatch:
    inputs:
      make-native:
        description: "Build native executables and package with electron-builder? yes/no"
        required: true
        default: "yes"
      make-draft:
        description: "Make draft release? yes/no"
        required: true
        default: "yes"
```

The workflow is run manually. Running GraalVM with every pull request makes no sense here. Java is specified only once as environment variable, other tool's versions are set to latest.

```yaml
env:
  JAVA_VERSION: "22"
```

---

The first job {{<code>}}build-jar{{</code>}} sets up JDK and gradle. A bootJar is built, then uploaded with the {{<code>}}upload-artifact{{</code>}} action. The last line specifies the jar path on the runner. Notice the wildcard - because the output file contains version. Uploading means uploading an artifact, which is stored temporarily and is available for other jobs as well as for download.

{{<tip>}}Artifacts are accessible only in the scope of a workflow.{{</tip>}}

```yaml
build-jar:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Setup JDK
      uses: actions/setup-java@v4
      with:
        java-version: ${{ env.JAVA_VERSION }}
        distribution: "temurin"
    - name: Setup Gradle
      uses: gradle/actions/setup-gradle@v4
      with:
        gradle-version: current
    - name: Grant execute permission for gradlew
      run: chmod +x ./gradlew
    - name: Build bootJar
      run: ./gradlew bootJar
    - name: Upload jar
      uses: actions/upload-artifact@v4
      with:
        name: MRT.jar
        path: build/libs/MRT-*.jar
```

For {{<code>}}upload-artifact{{</code>}}, the wildcard rules are:
| | |
| ----- | --- |
| build/libs/ | entire directory |
| build/\*\*/MRT.jar | recursively matches subdirectories |
| build/libs/MRT-\*.jar | matches characters until a dot |
| build/libs/M?T.jar | matches any character |

---

In the next job, the native build is invoked. [Cross-compilation](https://www.electron.build/multi-platform-build.html) is not easily possible, if at all. GitHub-hosted runners are great for this purpose. A [matrix](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow) acts like a loop. It repeats actions with different inputs.

```yaml
native-and-electron:
  runs-on: ${{ matrix.os }}
  strategy:
    fail-fast: true
    matrix:
      os: [ubuntu-latest, windows-latest, macos-latest]
      make-native: [yes]
  steps:
```

GraalVM JDK setup is handled by {{<code>}}[setup-graalvm](https://github.com/graalvm/setup-graalvm){{</code>}}. Npm dependencies specified in {{<code>}}package.json{{</code>}} need to be installed. Command {{<code>}}[npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci){{</code>}} is better suited for pipelines than {{<code>}}npm install{{</code>}}. Because my {{<code>}}package.json{{</code>}} is not in the root dir, I need to change to the {{<code>}}vue{{</code>}} directory first.

```yaml
- uses: actions/checkout@v4
  - name: Setup GraalVM
    uses: graalvm/setup-graalvm@v1
    with:
      java-version: ${{ env.JAVA_VERSION }}
      github-token: ${{ secrets.GITHUB_TOKEN }}
  - name: Setup Node.js and npm
    uses: actions/setup-node@v4
    with:
      node-version: 22
      cache: "npm"
      cache-dependency-path: "vue/package-lock.json"
  - name: Install npm dependencies
    run: |
      cd vue
      npm ci
```

The command {{<code>}}nativeCompile{{</code>}} initiates the GraalVM compilation. Generated executable's extension is .exe on Windows and on Linux, MacOS there is no extension. The first wildcard is for version, second is for the extension. The executable is generated in {{<code>}}build/native/nativeCompile{{</code>}}.

{{<tip>}}Native image extension on Windows is .exe while Linux, MacOS have none.{{</tip>}}

```yaml
- name: Build native executable
  run: |
    chmod +x ./gradlew
    ./gradlew nativeCompile
- name: Move native executable
  run: mv build/native/nativeCompile/MusicReleaseTracker* vue/buildResources/
- name: Electron builder
  run: |
    cd vue
    npm run distInstaller
- name: Upload installer
  uses: actions/upload-artifact@v4
  with:
    name: ${{ matrix.os }}
    path: vue/distribution/MRT-*.*
    if-no-files-found: error
```

With all the files uploaded, the names being the names of runners like {{<code>}}ubuntu-latest{{</code>}}, an optional release can be made. {{<code>}}needs{{</code>}} means the job can run only after the matrix has completed.

```yaml
draft-release:
  needs: native-and-electron
  runs-on: ubuntu-latest
  if: ${{ inputs.make-draft == 'yes' }}
  steps:
```

Jobs don't share information directly. The artifacts are downloaded with the action {{<code>}}download-artifact{{</code>}}. To avoid issues, use the {{<code>}}upload{{</code>}} and {{<code>}}download{{</code>}} actions of the same version. All our artifact names have {{<code>}}-latest{{</code>}} in common. {{<code>}}merge-multiple{{</code>}} downloads them on the runner in a single archive. The {{<code>}}action-gh-release{{</code>}} action is configured to take all contents of {{<code>}}downloaded{{</code>}} and to create a draft release.

```yaml
- uses: actions/checkout@v4
  - name: Download candidate artifacts
    uses: actions/download-artifact@v4
    with:
      path: downloaded
      pattern: "*-latest"
      merge-multiple: true
  - name: Release
    uses: softprops/action-gh-release@v2
    with:
      files: downloaded/**
      name: Draft release
      draft: true
```

Confused about artifact names? File is uploaded with an artifact name. The web interface allows manual download, which yields the file in a ZIP. The {{<code>}}download-artifact{{</code>}} downloads and automatically unzips the file on the runner. No wildcards are thus needed to preserve the file name.

{{<tip>}}GitHub artifact is stored as a ZIP. After uploading and downloading a file with artifact actions,
you are left with the same file with its original name.{{</tip>}}

This is the end of the pipeline. Be aware, however, that I omitted some lines. I will get to them shortly. So, sit back and dive into the details.

---

### Native from jar rather than from source

The initial intent was to build the bootJar and to upload it as an artifact. The {{<code>}}native-and-electron{{</code>}} job could download it and [build native from a JAR](https://www.graalvm.org/latest/reference-manual/native-image/guides/build-native-executable-from-jar/) instead of compiling from source. If you try this, you will be met with:

    Error: Main entry point class 'com.x.Main' neither found on classpath:
    '/build/libs/MRT.jar' nor modulepath: '/graalvm-jdk/lib/svm/library-support.jar'.

In a Spring executable jar, the [classpath](https://docs.spring.io/spring-boot/docs/3.2.7-SNAPSHOT/reference/html/executable-jar.html#appendix.executable-jar.nested-jars.jar-structure) is:

    MRT.jar
    ├── META-INF
    ├── org
    └── BOOT-INF
        └── classes
            └── com.blck
                └──MRT
                    └──Main.class

Whereas GraalVM searches the entry class at {{<code>}}com.blck.MRT.Main.class{{</code>}}. The issue is the extended structure of this jar. You could try a [custom shaded jar](https://stackoverflow.com/questions/76026874/graalvm-error-main-entry-point-class-org-example-main-neither-found-on-the-cl) or follow the docs. [AOT is another concern](https://www.graalvm.org/latest/reference-manual/native-image/guides/build-native-executable-from-jar/). I deem source compilation much simpler.

### Electron-builder config

One can configure electron-builder in {{<code>}}package.json{{</code>}}. Everything happens in {{<code>}}build{{</code>}}. The options can be found in the [docs](https://www.electron.build/). The excerpt shows how to set an output file name. The {{<code>}}${version}{{</code>}} is taken from the version higher up. The {{<code>}}.${ext}{{</code>}} means that the extension will match the original file's extension. I named the {{<code>}}/buildResources{{</code>}} folder, where additional build files and scripts exist, well, {{<code>}}buildResources{{</code>}}. {{<code>}}output{{</code>}}, that means the temporary build files and the installer, is set to the folder {{<code>}}/distribution{{</code>}}. Each platform has its tag where one can apply any options from the docs. Windows installers can be NSIS or MSI. And it has icon embedding! Another manual step was eliminated.

    "build": {
        "directories": {
            "output": "distribution",
            "buildResources": "buildResources"
        },
        "win": {
            "artifactName": "MRT-${version}-win.${ext}",
            "extraFiles": [
                {
                    "from": "buildResources/MusicReleaseTracker.exe",
                    "to": "buildResources/MusicReleaseTracker.exe"
                }
            ],
            "target": [ "msi" ],
            "icon": "buildResources/MRTicon.ico"
        },
        "msi": { ... },
        "linux": { ... },
        "mac": { ... }
    },

### Path strategy

This is the project's file structure.

    root
    ├── src/main/resources/static
    ├── build
    │   ├── libs
    │   └── native/nativeCompile
    └── vue
        ├── package.json
        ├── electron-main.js
        ├── buildResources
        ├── distribution
        └── src

The {{<code>}}electron-main.js{{</code>}} manages the lifecycle of the native executable. Where do I put the executable? I could leave it in {{<code>}}nativeCompile{{</code>}} and point to it.

```javascript
app.whenReady().then(() => {
    externalEXE = spawn("../build/native/nativeCompile/fileName", {
```

This works fine and doesn't require any moving. I could also point the electron-builder config there. The _distribution_ will not work. In the electron-builder config you may have noticed:

    "extraFiles": [
        {
            "from": "buildResources/MusicReleaseTracker.exe",
            "to": "buildResources/MusicReleaseTracker.exe"
        }
    ],

This specifies that the file at {{<code>}}from{{</code>}} location will be copied and located at the {{<code>}}to{{</code>}} location in distribution. The escaping {{<code>}}../{{</code>}} in {{<code>}}../build/native/nativeCompile/fileName{{</code>}} will cause toubles. I'm aware there are more ways to go around it. I move the executable to {{<code>}}buildResources{{</code>}} and then mirror the structure. Mirroring is so that I don't have to maintain 2 paths in {{<code>}}electron-main.js{{</code>}}.

```javascript
app.whenReady().then(() => {
    externalEXE = spawn("buildResources/fileName", {
```

Notably, the fileName extension there does not need to be specified. To sum up, backend file is moved to {{<code>}}buildResources{{</code>}}, where I already have icons and other resources for electron-builder. Built installers are located in {{<code>}}distribution{{</code>}}. Once all installers are ready, a release is drafted. The bootJar from the first action is located in {{<code>}}build/libs{{</code>}}.

### Point electron to port or index

There is the option of electron serving the static frontend files itself and the option of connecting to a port, like a browser previously.

```javascript
function createWindow() {
    win.loadFile("dist/index.html");
    win.loadURL("http://localhost:57782");
```

I don't see much difference here. I tried the former but couldn't get it to work properly. Surprising no one, the backend has to be running before {{<code>}}loadUrl{{</code>}} is called.

### CORS policy

For most of the time, I developed with Firefox. In Chrome, I ran into an issue of a missing CORS (Cross-site resource sharing) security policy. This could be due to different browser configurations. This measure prevents access to resources from a different port, like an axios request from 5173 to 8080. If you encounter this issue, set up a [Spring CORS proxy](https://spring.io/guides/gs/rest-service-cors#global-cors-configuration) that reroutes the requests to the origin port.

```java
@Bean
  public WebMvcConfigurer corsConfigurer() {
      return new WebMvcConfigurer() {
          @Override
          public void addCorsMappings(CorsRegistry registry) {
              registry.addMapping("/api/**").allowedOrigins("http://localhost:5173");
          }
      };
  }
```

### GraalVM AOT

So far, I omitted steps handling GraalVM AOT (ahead of time) compilation.

> The Native Image tool relies on static analysis of an application’s reachable code at runtime. However, the analysis cannot always completely predict all usages of the Java Native Interface (JNI), Java Reflection, Dynamic Proxy objects, or class path resources.

External resources can cause the compiled program to break. You may encounter an error like {{<code>}}Uncaught (in promise) TypeError: thing is undefined{{</code>}}. With external resources, you should provide tracing information to the AOT compiler.

The information is generated by [tracing agent](https://www.graalvm.org/latest/reference-manual/native-image/metadata/AutomaticMetadataCollection/). What worked for me is running the bootJar with Gradle argument:

    bootRun {
      jvmArgs("-agentlib:native-image-agent=config-output-dir=tracing")
    }

This generates the information in {{<code>}}/tracing{{</code>}} at root. You should verify the files to make sure they cover the problematic paths. The config files concern reflection, serialisation, JNI and more. In {{<code>}}resource-config.json{{</code>}} the frontend file was captured:

    "pattern":"\\QMETA-INF/resources/assets/index-CkTRZNgD.js\\E"

GraalVM will register the config files at {{<code>}}build/resources/aot/META-INF/native-image{{</code>}}. You can verify it additionally by compiling with [-H:Log=registerResource:3](https://www.graalvm.org/latest/reference-manual/native-image/dynamic-features/Resources/).

Unfortunately, [Vite appends hash](https://vitejs.dev/guide/assets) to static file names. The names are not guaranteed to stay the same. You could change this in Vite or make use of regular expressions.

    "pattern":"\\QMETA-INF/resources/assets/index-.*\\.js\\E"

You can put the files in the Git {{<code>}}/build{{</code>}} directory tree and compile only to see the tracing information disappear. I didn't verify this but I suspect that missing {{<code>}}build/resources/main/{{</code>}} triggers file reset before jar build or native compile. Since it contains frontend assets that shouldn't be hardcoded, on the runner I first build a bootJar to generate the file structure and then copy the tracing information.

```yaml
- name: Build bootJar to create file structure
    run: |
      chmod +x ./gradlew
      ./gradlew bootJar
- name: Copy AOT tracing info
    run: cp vue/buildResources/graal-tracing/* build/resources/aot/META-INF/native-image/
```

### Wrapping up

{{<tip>}}You can view the project's source code [here](https://github.com/BLCK-B/MusicReleaseTracker/blob/98db7a88b5196fe068769a497330a4f1622c3cf0/.github/workflows/distribution.yml).{{</tip>}}

As a result, I only have to launch the workflow and return later for a release confirmation. Virtual runners enable distribution for all platforms. JavaFX is no match for this setup. Interestingly, startup time despite the Electron window is roughly 0.5 s.

Last thing to improve is the development experience. To see a change in Vue.js in Electron window, GraalVM must currently compile a new executable. Remember that Electron is listening on the backend port. Using a [dev environment variable](https://npmjs.com/package/cross-env) to disable the native executable, the window will connect to a local server run from IDE. Then you can use something like [Spring Boot hot reload](https://docs.spring.io/spring-boot/reference/using/devtools.html).

```javascript
app.whenReady().then(() => {
  if (process.env.NODE_ENV !== "development") {
    externalEXE = spawn("buildResources/MusicReleaseTracker", {
```

Where is testing? I use trunk based development - protected main - so the code is guaranteed to be passing. I might follow with another post on that topic. ARM architecture is missing in my distribution (except MacOS) but seems to be a relatively simple addition.

I hope you found this useful. Any feedback is welcome.
