+++
title = "Spring 3 WebFlux Security: reactive username/password auth"
date = "2025-11-15"
+++

This article explains the implementation of username/password auth using Spring Security WebFlux. It contains example code for server-side and decentralised session management. The code examples are simplified and imperfect.

### Goal description

The auth system will be able to authenticate accounts against a database, and control access to backend API based on roles.

- User registers a new account
- User can log in using their credentials
- User can access the backend API and authentication is persisted

This test describes the login and session persistence of an already registered user:

```java
@Test
void securityContextRetention() {
    ResponseCookie loginSessionCookie = webTestClient
        .mutateWith(csrf())
        .post()
        .uri("/auth/login")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(credentials)
        .exchange()
        .expectStatus().isOk()
        .expectCookie()
        .exists("SESSION")
        .returnResult(Void.class)
        .getResponseCookies()
        .getFirst("SESSION");
    webTestClient
        .mutateWith(csrf())
        .get()
        .uri("/users/userAccountInfo")
        .cookie(loginSessionCookie.getName(), loginSessionCookie.getValue())
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class);
}
```

## A note on reactive Spring

Spring JPA is a synchronous, blocking ORM framework. Reactive DB access requires R2DBC which doesn't have the powerful abstractions like mapping annotations. Think twice about the benefits of reactivity. You almost certainly won't need it.

## Authentication objects and server-side session

**ServerSecurityContextRepository** is an interface with two methods to save and load a **SecurityContext**. The servlet implementation of **ServerSecurityContextRepository** is **HttpSessionSecurityContextRepository**. In Spring WebFlux, use the **WebSessionServerSecurityContextRepository**.

This repository is responsible for storing and retrieving the **SecurityContext** managed by the **SecurityContextHolder**. In short, **SecurityContext** contains the **Authentication** object. **Authentication** finally contains the username, password, and authorities/roles for authorisation. **Authentication** therefore acts as a token in an authentication request.

```
SecurityContextHolder
   └── SecurityContext
         └── Authentication
               ├── Principal (UserDetails)
               │     └── username, password
               ├── Authorities (Roles/Permissions)
               └── Credentials
```

During a user login, **Authentication** is processed by the interface **AuthenticationManager**, or in WebFlux, **ReactiveAuthenticationManager**. This code snippet shows how server-managed session might work:

```java
@PostMapping("/login")
public Mono<ResponseEntity<String>> login(@RequestBody CredentialsDTO credentials,
                                        ServerWebExchange exchange) {
    Authentication authRequest = new UsernamePasswordAuthenticationToken(
        credentials.username(),
        credentials.password()
    );
    return accountService.loginUser(exchange, authRequest);
}

public Mono<Void> loginUser(ServerWebExchange exchange, Authentication authRequest) {
    return reactiveAuthenticationManager.authenticate(authRequest)
        .flatMap(authResponse -> {
            SecurityContext securityContext = new SecurityContextImpl(authResponse);
            return securityContextRepository.save(exchange, securityContext);
        })
        .onErrorResume(e -> Mono.error(
            new InvalidCredentialsException("Invalid credentials: " + e)));
}
```

This requires some setup in Spring Security. **ReactiveAuthenticationManager** requires a **PasswordEncoder**. Security context repository provides the session handling.

```java
@Bean
public SecurityWebFilterChain apiFilterChain(ServerHttpSecurity http) {
    http
        .csrf(ServerHttpSecurity.CsrfSpec::disable)
        .securityContextRepository(new WebSessionServerSecurityContextRepository())
        .authorizeExchange(exchanges -> exchanges
                .pathMatchers("/auth/**").permitAll()
                .anyExchange().authenticated()
        );
    return http.build();
}

@Bean
public WebSessionServerSecurityContextRepository securityContextRepository() {
    return new WebSessionServerSecurityContextRepository();
}

@Bean
public ReactiveUserDetailsService userDetailsService(AccountService accountService) {
    return accountService;
}

@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
}

@Bean
public ReactiveAuthenticationManager reactiveAuthenticationManager(ReactiveUserDetailsService userDetailsService, PasswordEncoder passwordEncoder) {
    UserDetailsRepositoryReactiveAuthenticationManager authenticationManager = new UserDetailsRepositoryReactiveAuthenticationManager(userDetailsService);
    authenticationManager.setPasswordEncoder(passwordEncoder);
    return authenticationManager;
}
```

**UserDetails** is another abstraction interface. Beyond basic examples from the docs, this interface needs to be implemented by the custom user account object. This object can be stored in database. For example, in MongoDB:

```java
@Document(collection = "accounts")
public record UserAccount (
	@Id String id,
	String username,
	String password,
	boolean enabled,
	Set<String> roles
) implements UserDetails {
...
```

```java
public interface AccountRepository extends ReactiveMongoRepository<UserAccount, String> {
	Mono<UserAccount> findByUsername(String username);
}
```

The session persistence can be verified on a testing endpoint. **AuthenticationPrincipal** must contain the role USER, otherwise the request is rejected.

```java
@RestController
@RequestMapping("/users")
@PreAuthorize("hasRole('USER')")
public class UserController {

    @GetMapping("/userAccountInfo")
    public Mono<String> getUserAccountInfo(@AuthenticationPrincipal UserDetails userDetails) {
            return Mono.just(userDetails.getUsername());
    }
```

Please note that the application client has to include credentials in header. While the test at the beginning of the article would pass, a real browser needs more configuration.

```js
const FetchData = async () => {
    try {
        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body),
            credentials: "include",
        };

        const response = await fetch(URL + request, options);
```

## CSRF

CSRF requires more security config. It shouldn't be left disabled in Spring unless you handle it elsewhere. [This article](https://typeofnan.dev/using-cookie-based-csrf-tokens-for-your-single-page-application/) has a good explanation. When using backend sessions, Spring Security by default saves the session ID in response cookie. So that a malicious party can't make requests with our cookie in case it leaks, we should let Spring send an additional short-lived CSRF token in header (aside from the cookie). This code shows how to configure Spring Security to expect the token in request header:

```java
@Bean
public SecurityWebFilterChain apiFilterChain(ServerHttpSecurity http, ServerCsrfTokenRepository csrfTokenRepository) {
    ServerCsrfTokenRequestAttributeHandler csrfHandler = new ServerCsrfTokenRequestAttributeHandler();
    http
        .csrf(csrf -> csrf
            .csrfTokenRepository(csrfTokenRepository)
            .csrfTokenRequestHandler(csrfHandler)
        )
```

```java
@Configuration
@EnableWebFluxSecurity
@EnableReactiveMethodSecurity
public class SecurityConfiguration {
    ...
    @Bean
    public ServerCsrfTokenRepository csrfTokenRepository() {
        return CookieServerCsrfTokenRepository.withHttpOnlyFalse();
    }
```

{{<tip>}}CSRF is relevant even if we decide to embed JWTs in Authorization header.{{</tip>}}

---

## JWT: session-less context persistence

Another approach is persisting the authentication state in JSON Web Tokens. A JWT is a cryptographically signed token stored client-side. JWTs allow the backend to remain stateless. If the JWT is configured to be stored in a cookie with **same-site:strict** and  **httpOnly:true** attributes to make it inaccessible by code, CSRF becomes redundant. Cookie handling of JWT in Spring requires further setup:

```java
public Mono<String> loginUser(ServerWebExchange exchange, Authentication authentication) {
    return reactiveAuthenticationManager.authenticate(authentication)
        .flatMap(authResponse -> {
            JwsHeader header = JwsHeader.with(() -> "HS256").build();

            JwtClaimsSet claims = JwtClaimsSet.builder()
                .subject(authResponse.getName())
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plus(1, ChronoUnit.HOURS))
                .claim("roles", authResponse.getAuthorities().stream()
                        .map(GrantedAuthority::getAuthority).toList())
                .build();

            String token = jwtEncoder.encode(JwtEncoderParameters.from(header, claims))
                .getTokenValue();

            ResponseCookie cookie = ResponseCookie.from(String.valueOf(JWT_COOKIE_NAME), token)
                .httpOnly(true)
                .secure(true)
                .sameSite("Strict")
                .path("/")
                .maxAge(Duration.ofHours(1))
                .build();
            exchange.getResponse().addCookie(cookie);
            ...
        });
}
```

The token should be sent back on successful response and saved automatically by browser in **sameSite:strict** and **httpOnly:true** cookie. This way, it can't be accessed by JavaScript and stored in insecure storage. The cookie will be sent automatically to our service. JWT expiry and renewal is not subject of this article.

Spring needs more config to process the JWT acquired from a cookie. **NimbusEncoder** is a ready to use implementation of **JwtEncoder**:

```java
@Bean
public SecurityWebFilterChain apiFilterChain(ServerHttpSecurity http,
                                     AuthenticationWebFilter cookieAuthenticationWebFilter) {
    http
        .csrf(ServerHttpSecurity.CsrfSpec::disable)
        .oauth2ResourceServer(oauth2 -> oauth2
            .jwt(jwt -> jwt.jwtAuthenticationConverter(
                new ReactiveJwtAuthenticationConverterAdapter(jwtGrantedAuthoritiesConverter())
            ))
        )
        .addFilterAt(cookieAuthenticationWebFilter, SecurityWebFiltersOrder.AUTHENTICATION);
    ...
    
@Bean
public ReactiveJwtAuthenticationConverterAdapter jwtAuthenticationConverterAdapter() {
    return new ReactiveJwtAuthenticationConverterAdapter(jwtGrantedAuthoritiesConverter());
}

@Bean
public AuthenticationWebFilter cookieAuthenticationWebFilter(ReactiveJwtDecoder jwtDecoder) {
    JwtReactiveAuthenticationManager authenticationManager = new JwtReactiveAuthenticationManager(jwtDecoder);
    authenticationManager.setJwtAuthenticationConverter(jwtAuthenticationConverterAdapter());

    AuthenticationWebFilter authenticationWebFilter = new AuthenticationWebFilter(authenticationManager);
    authenticationWebFilter.setServerAuthenticationConverter(new CookieServerAuthenticationConverter());
    authenticationWebFilter.setRequiresAuthenticationMatcher(ServerWebExchangeMatchers.pathMatchers("/**"));
    return authenticationWebFilter;
}

private Converter<Jwt, AbstractAuthenticationToken> jwtGrantedAuthoritiesConverter() {
    JwtGrantedAuthoritiesConverter converter = new JwtGrantedAuthoritiesConverter();
    converter.setAuthoritiesClaimName("roles");
    converter.setAuthorityPrefix("");
    return jwt -> {
        Collection<GrantedAuthority> authorities = converter.convert(jwt).stream()
                .filter(auth -> Roles.doesRoleExist(auth.getAuthority()))
                .toList();
        return new JwtAuthenticationToken(jwt, authorities);
    };
}

@Bean
public JwtEncoder jwtEncoder() {
    SecretKeySpec secretKey = new SecretKeySpec(jwtSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    OctetSequenceKey jwk = new OctetSequenceKey.Builder(secretKey).build();
    JWKSource<SecurityContext> jwkSource = new ImmutableJWKSet<>(new JWKSet(jwk));
    return new NimbusJwtEncoder(jwkSource);
}

@Bean
public ReactiveJwtDecoder reactiveJwtDecoder() {
    SecretKeySpec secretKey = new SecretKeySpec(jwtSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    return NimbusReactiveJwtDecoder.withSecretKey(secretKey).build();
}
```

```java
@Component
public class CookieServerAuthenticationConverter implements ServerAuthenticationConverter {
	@Override
	public Mono<Authentication> convert(ServerWebExchange exchange) {
		return Mono.justOrEmpty(exchange
						.getRequest()
						.getCookies()
						.getFirst(String.valueOf(JWT_COOKIE_NAME)))
				.map(HttpCookie::getValue)
				.map(BearerTokenAuthenticationToken::new);
	}
}
```

{{<tip>}}The key for signing JWTs should never be stored in version control.{{</tip>}}

Lastly, the updated test to verify the JWT context retention:

```java
@Test
void securityContextRetention() {
    when(accountRepository.findByUsername(any())).thenReturn(Mono.just(encodedAccount));

    String jwtToken = Objects.requireNonNull(webTestClient
        .post()
        .uri("/auth/login")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(credentials)
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class)
        .returnResult()
        .getResponseCookies()
        .getFirst(String.valueOf(JWT_COOKIE_NAME)))
        .getValue();
    webTestClient
        .get()
        .uri("/users/userAccountInfo")
        .cookie(String.valueOf(JWT_COOKIE_NAME), jwtToken)
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class)
        .value(response -> assertEquals(encodedAccount.getUsername(), response));
}
```

---

## Sources

These are some of the docs and examples I found helpful. Most relate to Spring MVC.

- [Spring Security docs: Authorization Server getting started](https://docs.spring.io/spring-authorization-server/reference/getting-started.html)
- [Spring Security docs: servlet configuration](https://docs.spring.io/spring-security/reference/servlet/configuration/java.html)
- [Spring Security docs: servlet example username/password authentication](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/index.html)
- [Spring Kotlin with reactive repository and UserDetails overrides example](https://www.tomaszezula.com/spring-security-webflux-load-users-from-a-database/)
- [StackOverflow: Security Context with HttpSessionSecurityContextRepository](https://stackoverflow.com/questions/78715997/security-context-with-httpsessionsecuritycontextrepository-always-returns-403-af)
- [Spring Security docs: CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html#csrf-token-repository-cookie)
- [Article: CSRF explainer](https://typeofnan.dev/using-cookie-based-csrf-tokens-for-your-single-page-application/)
- [Spring Security docs: Resource Server JWT](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)