# TorobRent

TorobRent helps people discover residential and commercial Properties for rent and lets platform
staff control which rental information is published.

## People

**Renter**:
A person or organization searching for a residential or commercial Property to rent. A Renter does
not need an account to search or inspect published rental information.
_Avoid_: Customer, searcher

**Submitter**:
An authenticated person who proposes rental information for publication on TorobRent.
_Avoid_: Provider, advertiser

**Owner**:
A Submitter who asserts that they own the Property represented by a Submission.
_Avoid_: Landlord

**Agent**:
A Submitter who asserts that they are authorized to advertise a Property on an owner's behalf.
_Avoid_: Broker, realtor

**Operator**:
A verified account holder entrusted with one or more operational responsibilities, such as
performing Submission Reviews, maintaining published rental information, overseeing Link
Verification, or handling Support Requests. An Operator may also be a Submitter but cannot decide
their own work.
_Avoid_: Admin, moderator

**Operator Capability**:
An independently grantable operational responsibility. An account holder is an Operator when they
hold at least one Operator Capability; access to Django administration is separate.
_Avoid_: Operator type, Django staff status

## Rental catalog

**Property**:
A real-world residential or commercial space offered for rent whose normalized facts can be
presented independently of any one advertisement.
_Avoid_: Listing, advertisement

**Property Category**:
The broad intended-use grouping of a Property: Residential or Commercial.
_Avoid_: Business type

**Property Type**:
The physical kind of Property within a Property Category: Apartment, House, Villa, Office, Shop,
Warehouse, or Workshop.
_Avoid_: Property Category, subtype

**Listing**:
One source's advertisement of a Property, including source-specific rental terms and a route to
continue with that source. Several Listings can refer to the same Property.
_Avoid_: Property, search result

**Active Listing**:
A published Listing whose stated availability has not expired and which has not been marked
unavailable. Only Active Listings make a Property eligible for search.
_Avoid_: Published listing

**Source**:
The website or direct TorobRent channel from which a Listing originates.
_Avoid_: Provider

**Submission**:
A Submitter's proposal for rental information to become a TorobRent Listing after operator
review.
_Avoid_: Listing, property

**Availability Confirmation**:
A Submitter's assertion that an unchanged Listing remains available, extending its publication
without proposing new rental information.
_Avoid_: Resubmission, reminder

**Submission Review**:
An Operator's evaluation of a Submission, resulting in a request for changes, rejection, or
approval and publication. It is distinct from an Availability Confirmation.
_Avoid_: Product confirmation, confirmation

**Review Claim**:
A time-limited assignment giving one Operator responsibility for a Submission Review while leaving
the final decision subject to concurrency checks.
_Avoid_: Lock, ownership

**Link Verification**:
An assessment of whether an external Listing route satisfies TorobRent's link criteria. It is
distinct from an Availability Confirmation and may be performed manually or automatically.
_Avoid_: Link confirmation

**Rental Terms**:
The deposit and monthly-rent amounts advertised together by one Listing. The two amounts remain a
pair when filtering, sorting, and comparing Listings.
_Avoid_: Price, property price

**Feature State**:
An explicit assertion that a Property feature is present or absent, or an acknowledgement that the
feature is unknown. Missing source information is not treated as absence.
_Avoid_: Boolean feature

## Support

**Support Request**:
A person's request for guidance, account assistance, or a privacy-related action. A Support Request
is handled by one Operator at a time and retains its operational history.
_Avoid_: Contact message, ticket

**Intake Kind**:
The requester's description of why they opened a Support Request. It guides initial routing but is
not an authoritative assessment of the request.
_Avoid_: Classification

**Support Classification**:
An Operator's authoritative categorization of a Support Request, controlling its workflow and
privacy boundary. A Support Classification may differ from the requester's Intake Kind.
_Avoid_: Intake kind, request type
