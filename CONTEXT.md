# TorobRent

TorobRent helps people discover residential and commercial Properties for rent and lets platform
staff control which rental information is published.

## People

**Renter**:
A person or organization searching for a residential or commercial Property to rent. A Renter does
not need an account to search or inspect published rental information, but may use one to retain
Favorites.
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

**Source Representative**:
A Submitter who asserts that they own, manage, or are authorized to introduce an external Source
through a Source Proposal.
_Avoid_: Agent, Source owner

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

**Floor Area**:
The usable size of a Property's floor space, measured in square meters.
_Avoid_: Area, geographic area, Map Viewport

**Property Image**:
A stored, Operator-reviewed image representing a Property independently of the Listing currently
selected for its Rental Terms.
_Avoid_: Listing image, advertisement image

**Listing**:
One source's advertisement of a Property, including source-specific rental terms and a route to
continue with that source. Several Listings can refer to the same Property.
_Avoid_: Property, search result

**Direct Listing**:
A Listing whose continuation route is a verified contact number approved for public display by the
Submitter.
_Avoid_: Direct Submission, phone Listing

**External Listing**:
A Listing whose continuation route is the original advertisement URL at an external Source.
_Avoid_: Imported Listing, website Listing

**Active Listing**:
A published Listing whose stated availability has not expired and which has not been marked
unavailable. Only Active Listings make a Property eligible for search.
_Avoid_: Published listing

**Source**:
The website or direct TorobRent channel from which a Listing originates.
_Avoid_: Provider

**Source Proposal**:
A Submitter's request for TorobRent to validate an external Source and discover its rental
information. One Source Proposal may yield multiple External Listing candidates.
_Avoid_: Submission, website Submission, bulk Submission

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

**Bedroom Count**:
The number of rooms in a residential Property intended specifically for sleeping.
_Avoid_: Room count, rooms

**Approximate Location**:
The deliberately imprecise public area in which a Property is located, preserving its usefulness
for geographic discovery without revealing its exact position.
_Avoid_: Property address

**Exact Location**:
The restricted position of a Property, when known, from which its Approximate Location may be
derived. It is not published to Renters.
_Avoid_: Public location, map marker

**Tehran Search Boundary**:
The slightly padded geographic boundary around Tehran's 22 municipal districts within which a
Renter may navigate while searching the current Tehran market.
_Avoid_: Tehran viewport, map bounds

**Favorite**:
An authenticated Renter's saved interest in a Property, independent of any particular Listing. It
persists while the Property is unavailable and follows a merge, but ceases when the Property is
permanently removed.
_Avoid_: Saved Listing, bookmark, like

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
