+++
title = "Liquibase in Spring / IntelliJ / Gradle / CLI, changelog conflicts"
date = "2025-12-06"
+++

What's the difference between the Liquibase Gradle buildscript, standalone CLI, Spring starter and IntelliJ plugin? 
- [Liquibase standalone download](https://www.liquibase.com/download-community)
- [Gradle buildscript setup](https://github.com/liquibase/liquibase-gradle-plugin/blob/master/doc/usage.md)
- [Spring starter setup](https://contribute.liquibase.com/extensions-integrations/directory/integration-docs/springboot/)
- [IntelliJ plugin docs](https://www.jetbrains.com/help/idea/liquibase.html#changelog-preview-window)

Liquibase standalone is a system-wide CLI. It's useful for running manual commands. Its usage is shown in this article.

The Gradle plugin is just a plugin for Gradle meant as a thin wrapper of Liquibase. It's independent of Spring and other frameworks. An example configuration is difficult to create because of many deprecations. This worked briefly for me:

```groovy
buildscript {
    repositories {
        mavenCentral()
    }
    dependencies {
        classpath 'org.liquibase:liquibase-core:4.33.0'
    }
}

plugins {
    id 'java'
    id 'org.springframework.boot' version '3.4.2'
    id 'io.spring.dependency-management' version '1.1.7'
    id 'org.liquibase.gradle' version '3.0.2'
}

repositories {
    mavenCentral()
}
...

dependencies {
    ...
    runtimeOnly 'org.postgresql:postgresql:42.7.8'

    liquibaseRuntime 'org.liquibase:liquibase-core:4.33.0'
    liquibaseRuntime 'info.picocli:picocli:4.7.7'
    liquibaseRuntime 'org.postgresql:postgresql:42.7.8'
}
apply plugin: "org.liquibase.gradle"
...
// config can also be in application.properties
liquibase {
    activities {
        main {
            arguments = [
                changelogFile: 'src/main/resources/db/changelogs.xml',
                url          : 'jdbc:postgresql://localhost:5432/exampledb',
                username     : 'username',
                password     : 'password',
                driver       : 'org.postgresql.Driver'
            ]
        }
    }
    runList = 'main'
}
```

This adds Gradle tasks like **./gradlew update** and **./gradlew dropAll**. See [Liquibase command documentation](https://docs.liquibase.com/reference-guide).

The Spring starter comes as in the form of the `spring-boot-starter-liquibase` package. It is only a single line in **build.gradle**. Basic configuration in application.yml:

```yaml
spring:
  main:
    web-application-type: servlet
  datasource:
    url: jdbc:postgresql://localhost:5432/exampledb
    username: username
    password: password
    driver-class-name: org.postgresql.Driver
  liquibase:
    enabled: true
    change-log: classpath:db/changelogs.xml
```

The **enabled: true** property tells Spring to run the changelogs on each application start. I have a main changelog file named **changelogs.xml**:
```xml
<databaseChangeLog>
    <include file="/db/changelogs/2025-09-28-init.xml" relativeToChangelogFile="false"/>
    <include file="/db/changelogs/2025-10-31-add-fe-salt-col.xml" relativeToChangelogFile="false"/>
    <include file="/db/changelogs/2025-11-01-add-encryption-salt-col.xml" relativeToChangelogFile="false"/>
    ...
```

The starter doesn't provide a way to run Liquibase commands. For debugging, we should ideally have a standalone Liquibase CLI.

Lastly, IntelliJ has a Liquibase plugin. It adds a button to manually run Liquibase update (in the DB tab in sidebar). In the settings, the changelog directory and name can be configured.

## Changelog tracking collisions

If you run an update manually using the IntelliJ plugin, it may report that all changelogs we already run. But when starting the Spring app, the automatic migration may fail during an attempt to run the changelogs anyway. How can each tool see a different state of the DB?

Let's see how to troubleshoot this. Assuming a PostgresSQL DB in a container:

```bash
docker ps
docker exec -it <hashid> psql -U username -d exampledb
```

Liquibase tracks the applied changelogs in a **databasechangelog** table.

```sql
SELECT id, author, filename, dateexecuted FROM databasechangelog ORDER BY filename, id;
```

I already ran a migration via both the IntelliJ plugin and the Spring starter. The content of the tracking table revealed a filename/path collision:

```
create-accounts     | BLCK | db/changelogs/2025-09-28-init.xml | 2025-12-06 12:30:41.59 
setup-generation    | BLCK | db/changelogs/2025-09-28-init.xml | 2025-12-06 12:30:41.58
create-accounts     | BLCK | src/main/resources/db/changelogs/2025-09-28-init.xml | 2025-12-06 12:30:04.23
create-plans        | BLCK | src/main/resources/db/changelogs/2025-09-28-init.xml | 2025-12-06 12:30:04.254776
```

I know that all the changelogs have already run. So to reset this table to a correct state, I truncated it and used the Liquibase CLI to sync the changelogs:

```sql
TRUNCATE TABLE public.databasechangelog RESTART IDENTITY CASCADE;
```

```bash
cd src/main/resources

liquibase --url="jdbc:postgresql://localhost:5432/exampledb"
    --username=username
    --password=password
    --changeLogFile=db/changelogs.xml
    --classpath="pathTo.jar"
    changelogSync
```

The Liquibase CLI requires a Postgres driver Jar, which can be downloaded [here](https://jdbc.postgresql.org/download/). The directory from which this command is run determines the path in the changelog naming. The Spring Liquibase starter configured with `change-log: classpath:db/changelogs.xml` resolves paths relative to the **resources** folder. I ran the changelogSync from the **resources** folder so that the naming is correct: `db/changelogs/abc.xml`.